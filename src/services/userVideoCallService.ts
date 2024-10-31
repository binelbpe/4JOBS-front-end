import { Buffer } from "buffer";
import { getWebRTCConfig } from "../config/webrtcConfig";

class UserVideoCallService {
  private peerConnection: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  public onRemoteStreamUpdate: ((stream: MediaStream) => void) | null = null;
  public onIceCandidate: ((candidate: RTCIceCandidate) => void) | null = null;
  public onCallStateChange: ((state: string) => void) | null = null;

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
      console.log('Initializing peer connection with Twilio...');
      
      if (this.peerConnection) {
        this.peerConnection.close();
      }

      const config = await getWebRTCConfig();
      console.log("Got Twilio WebRTC config:", {
        iceServers: config.iceServers?.length || 0,
        iceTransportPolicy: config.iceTransportPolicy,
        usingTwilio: config.iceServers?.some(server => 
          server.urls.toString().includes('twilio.com')
        ) || false
      });

      this.peerConnection = new RTCPeerConnection(config);

      if (!this.peerConnection) {
        throw new Error("Failed to create peer connection");
      }

      // Add ICE candidate handler like Twilio's example
      this.peerConnection.onicecandidate = (event) => {
        if (event.candidate && this.onIceCandidate) {
          console.log("Generated ICE candidate:", {
            type: event.candidate.type,
            protocol: event.candidate.protocol,
            address: event.candidate.address
          });
          this.onIceCandidate(event.candidate);
        }
      };

      // Monitor ICE gathering state
      this.peerConnection.onicegatheringstatechange = () => {
        console.log("ICE gathering state:", this.peerConnection?.iceGatheringState);
      };

      // Monitor connection state
      this.peerConnection.onconnectionstatechange = () => {
        console.log("Connection state:", this.peerConnection?.connectionState);
        if (this.onCallStateChange) {
          this.onCallStateChange(this.peerConnection?.connectionState || 'disconnected');
        }
      };

      // Add queue for ICE candidates received before remote description
      const iceCandidateQueue: RTCIceCandidate[] = [];

      this.peerConnection.ontrack = (event) => {
        try {
          console.log("Track received:", {
            kind: event.track.kind,
            enabled: event.track.enabled,
            readyState: event.track.readyState,
            settings: event.track.getSettings()
          });

          if (!this.remoteStream) {
            this.remoteStream = new MediaStream();
            console.log("Created new remote stream");
          }

          // Handle track replacement
          const existingTrack = this.remoteStream.getTracks().find(
            t => t.kind === event.track.kind
          );
          if (existingTrack) {
            console.log(`Removing existing ${event.track.kind} track`);
            this.remoteStream.removeTrack(existingTrack);
            existingTrack.stop();
          }

          // Ensure track is enabled and active
          event.track.enabled = true;

          // Add track to stream
          this.remoteStream.addTrack(event.track);
          console.log(`Added ${event.track.kind} track to remote stream`);

          // Monitor track state
          event.track.onmute = () => {
            console.log(`Remote ${event.track.kind} track muted`);
            event.track.enabled = true; // Try to re-enable
          };

          event.track.onunmute = () => {
            console.log(`Remote ${event.track.kind} track unmuted`);
          };

          event.track.onended = () => {
            console.log(`Remote ${event.track.kind} track ended`);
            // Try to restart the track
            if (event.track.kind === 'video' && this.peerConnection?.connectionState === 'connected') {
              this.tryConnectionRecovery();
            }
          };

          if (this.onRemoteStreamUpdate) {
            console.log("Notifying remote stream update");
            this.onRemoteStreamUpdate(this.remoteStream);
          }
        } catch (error) {
          console.error("Error handling remote track:", error);
        }
      };

      this.peerConnection.onicecandidate = (event) => {
        if (event.candidate && this.onIceCandidate) {
          console.log("Generated ICE candidate:", {
            type: event.candidate.type,
            protocol: event.candidate.protocol,
            address: event.candidate.address
          });
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
      this.handleIceCandidate = async (
        candidateBase64: string
      ): Promise<void> => {
        if (!this.peerConnection) {
          throw new Error("Peer connection not initialized");
        }

        try {
          const candidateString = Buffer.from(
            candidateBase64,
            "base64"
          ).toString("utf-8");
          const candidate = JSON.parse(candidateString);
          const iceCandidate = new RTCIceCandidate(candidate);

          if (this.peerConnection.remoteDescription) {
            await this.peerConnection.addIceCandidate(iceCandidate);
            console.log("Added ICE candidate immediately");
          } else {
            console.log(
              "Queuing ICE candidate until remote description is set"
            );
            iceCandidateQueue.push(iceCandidate);
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

      // Add connection state monitoring
      this.peerConnection.onconnectionstatechange = () => {
        console.log("Connection state:", this.peerConnection?.connectionState);
        if (this.peerConnection?.connectionState === 'connected') {
          console.log("Peer connection established successfully");
        }
      };
    } catch (error) {
      console.error("Error initializing Twilio peer connection:", error);
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
        await Promise.all(
          senders.map(async (sender) => {
            try {
              await sender.replaceTrack(null);
              this.peerConnection?.removeTrack(sender);
            } catch (error) {
              console.warn("Error removing track:", error);
            }
          })
        );

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
      if (pc.signalingState !== "stable") {
        console.warn(
          "Peer connection not in stable state after initialization"
        );
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
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { min: 640, ideal: 1280, max: 1920 },
          height: { min: 480, ideal: 720, max: 1080 },
          frameRate: { min: 15, ideal: 24, max: 30 },
          facingMode: 'user',
          aspectRatio: { ideal: 1.7777777778 }
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000,
          channelCount: 2
        }
      });

      // Log track capabilities
      this.localStream.getTracks().forEach(track => {
        const settings = track.getSettings();
        console.log(`Local ${track.kind} track settings:`, settings);
        track.enabled = true;
      });

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

      if (!this.localStream) {
        await this.startLocalStream();
      }

      // Add tracks with monitoring
      this.localStream!.getTracks().forEach(track => {
        if (this.peerConnection) {
          const sender = this.peerConnection.addTrack(track, this.localStream!);
          console.log(`Added ${track.kind} track to peer connection:`, {
            enabled: track.enabled,
            settings: track.getSettings()
          });
        }
      });

      // Create and set offer
      const offer = await this.peerConnection!.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });

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
      await this.resetPeerConnection();

      if (!this.localStream) {
        await this.startLocalStream();
      }

      // Set remote description first
      const offerString = Buffer.from(offerBase64, "base64").toString("utf-8");
      const offer = JSON.parse(offerString);
      await this.peerConnection!.setRemoteDescription(new RTCSessionDescription(offer));
      console.log("Remote description set for incoming call");

      // Add local tracks
      this.localStream!.getTracks().forEach(track => {
        if (this.peerConnection) {
          const sender = this.peerConnection.addTrack(track, this.localStream!);
          console.log(`Added ${track.kind} track for incoming call:`, {
            enabled: track.enabled,
            settings: track.getSettings()
          });
        }
      });
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

export default new UserVideoCallService();
