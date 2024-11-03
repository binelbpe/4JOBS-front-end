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
          console.log("Received remote track:", {
            kind: event.track.kind,
            enabled: event.track.enabled,
            readyState: event.track.readyState
          });

          if (!this.remoteStream) {
            this.remoteStream = new MediaStream();
            console.log("Created new remote stream");
          }
          
          if (event.streams && event.streams[0]) {
            this.remoteStream = event.streams[0];
            console.log("Using stream from track event");
            
            if (this.onRemoteStreamUpdate) {
              this.onRemoteStreamUpdate(this.remoteStream);
            }
          }
    
          event.track.onmute = () => {
            console.log(`Remote ${event.track.kind} track muted`);
            event.track.enabled = true;
          };

          event.track.onunmute = () => {
            console.log(`Remote ${event.track.kind} track unmuted`);
          };

          event.track.onended = () => {
            console.log(`Remote ${event.track.kind} track ended`);
          };
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
   
      const originalSetRemoteDescription =
        this.peerConnection.setRemoteDescription.bind(this.peerConnection);
      this.peerConnection.setRemoteDescription = async (
        description: RTCSessionDescription
      ) => {
        await originalSetRemoteDescription(description);
        await processPendingCandidates();
      };


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

 
    if (this.peerConnection) {
      try {
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

 
    try {
      console.log("Initializing new peer connection");
      await this.initializePeerConnection();

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
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280, max: 1920 },
          height: { ideal: 720, max: 1080 },
          frameRate: { ideal: 24, max: 30 }
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      this.localStream = stream;
      return stream;
    } catch (error) {
      console.error("Error accessing media devices:", error);
      throw new Error("Could not access camera/microphone. Please check permissions.");
    }
  }

  async makeCall(recipientId: string): Promise<string> {
    try {
      await this.resetPeerConnection();

      if (!this.localStream) {
        await this.startLocalStream();
      }

      // Add tracks with transceivers
      this.localStream!.getTracks().forEach(track => {
        if (this.peerConnection) {
          this.peerConnection.addTrack(track, this.localStream!);
          console.log(`Added track to peer connection: ${track.kind}`);
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

      const offerString = Buffer.from(offerBase64, "base64").toString("utf-8");
      const offer = JSON.parse(offerString);
      await this.peerConnection!.setRemoteDescription(new RTCSessionDescription(offer));
      console.log("Remote description set for incoming call");

      // Add local tracks
      this.localStream!.getTracks().forEach(track => {
        if (this.peerConnection && this.localStream) {
          this.peerConnection.addTrack(track, this.localStream);
          console.log(`Added local track: ${track.kind}`);
        }
      });
    } catch (error) {
      console.error("Error handling incoming call:", error);
      throw error;
    }
  }

  async createAnswer(): Promise<string> {
    try {
      if (!this.peerConnection) {
        throw new Error("Peer connection not initialized");
      }

      // Create answer with specific constraints
      const answer = await this.peerConnection.createAnswer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });

      // Set local description immediately
      await this.peerConnection.setLocalDescription(answer);
      console.log("Local description set for answer");

      // Wait for ICE gathering to complete
      await new Promise<void>((resolve) => {
        if (this.peerConnection!.iceGatheringState === 'complete') {
          resolve();
        } else {
          this.peerConnection!.onicegatheringstatechange = () => {
            if (this.peerConnection!.iceGatheringState === 'complete') {
              resolve();
            }
          };
        }
      });

      return Buffer.from(JSON.stringify(this.peerConnection.localDescription)).toString("base64");
    } catch (error) {
      console.error("Error creating answer:", error);
      throw error;
    }
  }

  async handleAnswer(answerBase64: string): Promise<void> {
    try {
      if (!this.peerConnection) {
        throw new Error("Peer connection not initialized");
      }

      console.log("Handling answer...");
      const answerString = Buffer.from(answerBase64, "base64").toString("utf-8");
      const answer = JSON.parse(answerString);
      
      // Wait for ICE gathering to complete
      if (this.peerConnection.signalingState === "have-local-offer") {
        await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        console.log("Remote description set successfully");
      } else {
        console.warn("Unexpected signaling state:", this.peerConnection.signalingState);
      }
    } catch (error) {
      console.error("Error handling answer:", error);
      throw error;
    }
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

const userVideoCallService = new UserVideoCallService();
export default userVideoCallService;
