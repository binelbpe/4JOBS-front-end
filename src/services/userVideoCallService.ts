import { Buffer } from "buffer";
import { getWebRTCConfig } from "../config/webrtcConfig";

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

  private async initializePeerConnection(): Promise<void> {
    try {
      if (this.peerConnection) {
        this.peerConnection.close();
        this.peerConnection = null;
      }

      // Get configuration and ensure it's valid
      const config = await getWebRTCConfig();
      console.log("Got WebRTC config:", config);

      if (!config || !config.iceServers) {
        throw new Error("Invalid WebRTC configuration");
      }

      // Create new peer connection
      this.peerConnection = new RTCPeerConnection(config);
      
      if (!this.peerConnection) {
        throw new Error("Failed to create peer connection");
      }

      // Add queue for ICE candidates received before remote description
      const iceCandidateQueue: RTCIceCandidate[] = [];

      this.peerConnection.ontrack = (event) => {
        try {
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

          // Ensure we don't add duplicate tracks
          const existingTrack = this.remoteStream
            .getTracks()
            .find((t) => t.kind === event.track.kind);
          if (existingTrack) {
            this.remoteStream.removeTrack(existingTrack);
          }

          this.remoteStream.addTrack(event.track);
          console.log("Added track to remote stream:", event.track.kind);

          // Notify about stream update
          if (this.onRemoteStreamUpdate) {
            console.log(
              "Calling remote stream update with tracks:",
              this.remoteStream.getTracks().map((t) => `${t.kind}:${t.enabled}`)
            );
            this.onRemoteStreamUpdate(this.remoteStream);
          }

          // Monitor track status
          event.track.onended = () =>
            console.log(`Remote ${event.track.kind} track ended`);
          event.track.onmute = () =>
            console.log(`Remote ${event.track.kind} track muted`);
          event.track.onunmute = () =>
            console.log(`Remote ${event.track.kind} track unmuted`);
        } catch (error) {
          console.error("Error handling remote track:", error);
        }
      };

      this.peerConnection.onicecandidate = (event) => {
        if (event.candidate && this.onIceCandidate) {
          console.log("Generated ICE candidate for:", event.candidate.sdpMid);
          this.onIceCandidate(event.candidate);
        }
      };

      // Add method to handle pending candidates
      const processPendingCandidates = async () => {
        while (iceCandidateQueue.length > 0) {
          const candidate = iceCandidateQueue.shift();
          if (candidate && this.peerConnection) {
            try {
              await this.peerConnection.addIceCandidate(candidate);
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
      this.handleIceCandidate = async (candidateBase64: string): Promise<void> => {
        if (!this.peerConnection) {
          throw new Error("Peer connection not initialized");
        }

        try {
          const candidateString = Buffer.from(candidateBase64, "base64").toString("utf-8");
          const candidate = JSON.parse(candidateString);
          const iceCandidate = new RTCIceCandidate(candidate);

          if (this.peerConnection.remoteDescription) {
            await this.peerConnection.addIceCandidate(iceCandidate);
            console.log("Added ICE candidate immediately");
          } else {
            console.log("Queuing ICE candidate until remote description is set");
            iceCandidateQueue.push(iceCandidate);
          }
        } catch (error) {
          console.error("Error handling ICE candidate:", error);
          throw error;
        }
      };

      // Update setRemoteDescription to process pending candidates
      const originalSetRemoteDescription = this.peerConnection.setRemoteDescription.bind(this.peerConnection);
      this.peerConnection.setRemoteDescription = async (description: RTCSessionDescription) => {
        await originalSetRemoteDescription(description);
        await processPendingCandidates();
      };

    } catch (error) {
      console.error("Error initializing peer connection:", error);
      throw error;
    }
  }

  private async resetPeerConnection() {
    console.log("Resetting peer connection");
    
    // Clean up existing connection
    if (this.peerConnection) {
      try {
        // Remove all tracks
        const senders = this.peerConnection.getSenders();
        await Promise.all(senders.map(async (sender) => {
          try {
            await sender.replaceTrack(null);
            this.peerConnection?.removeTrack(sender);
          } catch (error) {
            console.warn("Error removing track:", error);
          }
        }));

        this.peerConnection.close();
      } catch (error) {
        console.warn("Error closing peer connection:", error);
      }
      this.peerConnection = null;
    }

    // Initialize new connection
    try {
      console.log("Initializing new peer connection");
      await this.initializePeerConnection();

      // Type guard to ensure peerConnection exists and has correct type
      if (!this.peerConnection) {
        throw new Error("Failed to initialize peer connection");
      }

      // Use type assertion to access signalingState
      const pc = this.peerConnection as RTCPeerConnection;
      if (pc.signalingState !== 'stable') {
        console.warn("Peer connection not in stable state after initialization");
        throw new Error("Peer connection in invalid state");
      }

      return this.peerConnection;
    } catch (error) {
      console.error("Error in resetPeerConnection:", error);
      throw error;
    }
  }

  async startLocalStream(): Promise<MediaStream> {
    try {
      console.log("Starting local stream...");

      // First check if permissions are granted
      const permissions = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      }).catch((error) => {
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
          frameRate: { ideal: 30 }
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
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
      await this.resetPeerConnection();

      if (!this.peerConnection) {
        throw new Error("Peer connection not initialized");
      }

      if (!this.localStream) {
        await this.startLocalStream();
      }

      // Add tracks first
      const audioTrack = this.localStream!.getAudioTracks()[0];
      const videoTrack = this.localStream!.getVideoTracks()[0];

      if (audioTrack) {
        this.peerConnection.addTrack(audioTrack, this.localStream!);
        console.log("Added audio track");
      }

      if (videoTrack) {
        this.peerConnection.addTrack(videoTrack, this.localStream!);
        console.log("Added video track");
      }

      // Create and set offer
      const offer = await this.peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });

      await this.peerConnection.setLocalDescription(offer);
      console.log("Local description set for outgoing call");

      return Buffer.from(JSON.stringify(offer)).toString("base64");
    } catch (error) {
      console.error("Error making call:", error);
      throw error;
    }
  }

  async handleIncomingCall(offerBase64: string): Promise<void> {
    try {
      // Wait for peer connection reset to complete
      await this.resetPeerConnection();

      if (!this.peerConnection) {
        throw new Error("Peer connection initialization failed");
      }

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
      
      // Double check peer connection exists
      if (!this.peerConnection) {
        throw new Error("Peer connection lost during setup");
      }

      await this.peerConnection.setRemoteDescription(
        new RTCSessionDescription(offer)
      );
      console.log("Remote description set for incoming call");

      // Add error recovery
      this.peerConnection.onicecandidateerror = (event) => {
        console.error("ICE candidate error:", event);
      };

      this.peerConnection.onconnectionstatechange = () => {
        console.log("Connection state:", this.peerConnection?.connectionState);
        if (this.peerConnection?.connectionState === 'failed') {
          void this.tryConnectionRecovery();
        }
      };

    } catch (error) {
      console.error("Error handling incoming call:", error);
      // Add cleanup on error
      if (this.peerConnection) {
        this.peerConnection.close();
        this.peerConnection = null;
      }
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
