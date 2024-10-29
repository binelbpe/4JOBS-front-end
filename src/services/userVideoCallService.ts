import { Buffer } from "buffer";
import { webRTCConfig } from "../config/webrtcConfig";

class UserVideoCallService {
  private peerConnection: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private onRemoteStreamUpdate: ((stream: MediaStream) => void) | null = null;
  private onCallStateChange: ((state: string) => void) | null = null;
  private onIceCandidate: ((candidate: RTCIceCandidate) => void) | null = null;
  private initialized = false;

  constructor() {
    this.initializePeerConnection();
  }

  private async tryConnectionRecovery(): Promise<void> {
    try {
      if (this.peerConnection) {
        await this.peerConnection.restartIce();
        console.log("Attempting ICE restart");
      }
    } catch (error) {
      console.error("Failed to recover connection:", error);
    }
  }

  private initializePeerConnection(): void {
    if (this.peerConnection) {
      this.peerConnection.close();
    }

    this.peerConnection = new RTCPeerConnection(webRTCConfig);

    this.peerConnection.ontrack = (event) => {
      console.log("Track received:", {
        kind: event.track.kind,
        enabled: event.track.enabled,
        readyState: event.track.readyState,
        muted: event.track.muted,
      });

      if (!this.remoteStream) {
        this.remoteStream = new MediaStream();
        console.log("Created new remote MediaStream");
      }

      event.streams.forEach((stream) => {
        console.log("Adding remote stream:", stream.id);
        if (
          !this.remoteStream!.getTracks().some((t) => t.id === event.track.id)
        ) {
          this.remoteStream!.addTrack(event.track);
        }
      });

      if (this.onRemoteStreamUpdate) {
        console.log(
          "Calling remote stream update with tracks:",
          this.remoteStream.getTracks().map((t) => `${t.kind}:${t.enabled}`)
        );
        this.onRemoteStreamUpdate(this.remoteStream);
      }
    };

    // Add queue for ICE candidates received before remote description
    const pendingIceCandidates: RTCIceCandidate[] = [];

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate && this.onIceCandidate) {
        console.log("Generated ICE candidate for:", event.candidate.sdpMid);
        this.onIceCandidate(event.candidate);
      }
    };

    // Add method to handle pending candidates
    const processPendingCandidates = async () => {
      while (pendingIceCandidates.length > 0) {
        const candidate = pendingIceCandidates.shift();
        if (candidate) {
          try {
            await this.peerConnection!.addIceCandidate(candidate);
            console.log("Added pending ICE candidate");
          } catch (error) {
            console.error("Error adding pending ICE candidate:", error);
          }
        }
      }
    };

    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection?.connectionState;
      console.log("Connection state changed to:", state);

      if (state === "failed" || state === "disconnected") {
        void this.tryConnectionRecovery();
      }
    };

    this.peerConnection.oniceconnectionstatechange = () => {
      const state = this.peerConnection?.iceConnectionState;
      console.log("ICE connection state changed to:", state);

      if (state === "failed") {
        this.peerConnection?.restartIce();
      }

      if (this.onCallStateChange && state) {
        this.onCallStateChange(state);
      }
    };

    this.peerConnection.onnegotiationneeded = async () => {
      try {
        if (this.peerConnection) {
          console.log("Negotiation needed");
          const offer = await this.peerConnection.createOffer();
          await this.peerConnection.setLocalDescription(offer);
        }
      } catch (error) {
        console.error("Error during negotiation:", error);
      }
    };

    // Update handleIceCandidate method
    this.handleIceCandidate = async (
      candidateBase64: string
    ): Promise<void> => {
      if (!this.peerConnection) {
        throw new Error("Peer connection not initialized");
      }

      try {
        const candidateString = Buffer.from(candidateBase64, "base64").toString(
          "utf-8"
        );
        const candidate = JSON.parse(candidateString);
        const iceCandidate = new RTCIceCandidate(candidate);

        if (this.peerConnection.remoteDescription) {
          await this.peerConnection.addIceCandidate(iceCandidate);
          console.log("Added ICE candidate immediately");
        } else {
          console.log("Queuing ICE candidate until remote description is set");
          pendingIceCandidates.push(iceCandidate);
        }
      } catch (error) {
        console.error("Error handling ICE candidate:", error);
        throw error;
      }
    };

    // Update setRemoteDescription to process pending candidates
    const originalSetRemoteDescription =
      this.peerConnection.setRemoteDescription.bind(this.peerConnection);
    this.peerConnection.setRemoteDescription = async (
      description: RTCSessionDescription
    ) => {
      await originalSetRemoteDescription(description);
      await processPendingCandidates();
    };
  }

  private resetPeerConnection() {
    console.log("Resetting peer connection");
    if (this.peerConnection) {
      // Remove all tracks from peer connection
      const senders = this.peerConnection.getSenders();
      senders.forEach((sender) => {
        this.peerConnection?.removeTrack(sender);
      });

      this.peerConnection.close();
      this.peerConnection = null;
    }

    console.log("Initializing new peer connection");
    this.initializePeerConnection();

    if (!this.peerConnection) {
      throw new Error("Failed to initialize peer connection");
    }
  }

  async startLocalStream(): Promise<MediaStream> {
    try {
      console.log("Starting local stream...");

      // First check if permissions are granted
      const permissions = await navigator.mediaDevices
        .getUserMedia({
          audio: true,
          video: true,
        })
        .catch((error) => {
          console.error("Permission error:", error);
          throw new Error("Camera/Microphone permission denied");
        });

      permissions.getTracks().forEach((track) => track.stop());

      console.log("Requesting media with constraints...");
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: "user",
          frameRate: { ideal: 30 },
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      console.log(
        "Local stream obtained with tracks:",
        this.localStream.getTracks().map((t) => ({
          kind: t.kind,
          enabled: t.enabled,
          readyState: t.readyState,
        }))
      );

      return this.localStream;
    } catch (error) {
      console.error("Error getting local stream:", error);
      throw error;
    }
  }

  async makeCall(recipientId: string): Promise<string> {
    try {
      const setupTimeout = new Promise<string>((_, reject) => {
        setTimeout(() => reject(new Error("Call setup timeout")), 30000);
      });

      const callSetup = this._makeCallInternal(recipientId);
      const result = await Promise.race([callSetup, setupTimeout]);
      return result;
    } catch (error) {
      console.error("Error in call setup:", error);
      throw error;
    }
  }

  private async _makeCallInternal(recipientId: string): Promise<string> {
    try {
      this.resetPeerConnection();

      if (!this.localStream) {
        await this.startLocalStream();
      }

      // Add transceivers before creating offer
      const audioTransceiver = this.peerConnection!.addTransceiver("audio", {
        direction: "sendrecv",
      });
      const videoTransceiver = this.peerConnection!.addTransceiver("video", {
        direction: "sendrecv",
      });

      // Then add tracks
      this.localStream!.getTracks().forEach((track) => {
        if (this.peerConnection) {
          console.log("Adding track to outgoing call:", track.kind, track.id);
          this.peerConnection.addTrack(track, this.localStream!);
        }
      });

      const offer = await this.peerConnection!.createOffer();
      await this.peerConnection!.setLocalDescription(offer);
      console.log("Local description set for outgoing call");

      return Buffer.from(JSON.stringify(offer)).toString("base64");
    } catch (error) {
      console.error("Error making call:", error);
      throw error;
    }
  }

  async handleIncomingCall(offerBase64: string): Promise<void> {
    try {
      this.resetPeerConnection();

      // First get local stream
      if (!this.localStream) {
        await this.startLocalStream();
      }

      // Add local tracks before setting remote description
      this.localStream!.getTracks().forEach((track) => {
        if (this.peerConnection) {
          console.log("Adding local track for incoming call:", track.kind);
          this.peerConnection.addTrack(track, this.localStream!);
        }
      });

      // Then set remote description
      const offerString = Buffer.from(offerBase64, "base64").toString("utf-8");
      const offer = JSON.parse(offerString);
      await this.peerConnection!.setRemoteDescription(
        new RTCSessionDescription(offer)
      );
      console.log("Remote description set for incoming call");
    } catch (error) {
      console.error("Error handling incoming call:", error);
      throw error;
    }
  }

  async createAnswer(): Promise<string> {
    try {
      console.log("Starting to create answer");

      if (!this.peerConnection) {
        console.error("No peer connection available for creating answer");
        throw new Error("Peer connection not initialized");
      }

      console.log("Creating answer with peer connection state:", {
        connectionState: this.peerConnection.connectionState,
        signalingState: this.peerConnection.signalingState,
        iceGatheringState: this.peerConnection.iceGatheringState,
        iceConnectionState: this.peerConnection.iceConnectionState,
      });

      const answer = await this.peerConnection.createAnswer();
      console.log("Answer created:", {
        type: answer.type,
        sdpLength: answer.sdp?.length,
      });

      await this.peerConnection.setLocalDescription(answer);
      console.log("Local description set for answer");

      const answerString = JSON.stringify(answer);
      return Buffer.from(answerString).toString("base64");
    } catch (error) {
      console.error("Error in createAnswer:", {
        error,
        peerConnectionState: this.peerConnection?.connectionState,
        signalingState: this.peerConnection?.signalingState,
      });
      throw error;
    }
  }

  async handleAnswer(answerBase64: string): Promise<void> {
    if (!this.peerConnection) {
      throw new Error("Peer connection not initialized");
    }

    const answerString = Buffer.from(answerBase64, "base64").toString("utf-8");
    const answer = JSON.parse(answerString);
    await this.peerConnection.setRemoteDescription(
      new RTCSessionDescription(answer)
    );
  }

  async handleIceCandidate(candidateBase64: string): Promise<void> {
    if (!this.peerConnection) {
      throw new Error("Peer connection not initialized");
    }

    const candidateString = Buffer.from(candidateBase64, "base64").toString(
      "utf-8"
    );
    const candidate = JSON.parse(candidateString);
    await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
  }

  setOnRemoteStreamUpdate(callback: (stream: MediaStream) => void): void {
    this.onRemoteStreamUpdate = callback;
  }

  setOnCallStateChange(callback: (state: string) => void): void {
    this.onCallStateChange = callback;
  }

  setOnIceCandidate(callback: (candidate: RTCIceCandidate) => void): void {
    this.onIceCandidate = callback;
  }

  disconnectCall(): void {
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        track.stop();
      });
    }
    if (this.remoteStream) {
      this.remoteStream.getTracks().forEach((track) => {
        track.stop();
      });
    }
    if (this.peerConnection) {
      this.peerConnection.close();
    }
    this.localStream = null;
    this.remoteStream = null;
    this.peerConnection = null;
    if (this.onCallStateChange) {
      this.onCallStateChange("ended");
    }
    this.initialized = false;
  }

  muteAudio(mute: boolean): void {
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((track) => {
        track.enabled = !mute;
      });
    }
  }

  hideVideo(hide: boolean): void {
    if (this.localStream) {
      this.localStream.getVideoTracks().forEach((track) => {
        track.enabled = !hide;
      });
    }
  }
}

export const userVideoCallService = new UserVideoCallService();
