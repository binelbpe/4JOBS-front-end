import React, { useState, useEffect, useRef, useCallback } from "react";
import userVideoCallService from "../../services/userVideoCallService";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faMicrophone,
  faMicrophoneSlash,
  faVideo,
  faVideoSlash,
  faPhone,
} from "@fortawesome/free-solid-svg-icons";
import { socketService } from "../../services/socketService";
import { useCall } from "../../contexts/CallContext";

interface UserVideoCallProps {
  recipientId: string;
  onEndCall: () => void;
  incomingCallData?: { callerId: string; offer: string } | null;
}

interface IceData {
  candidate: RTCIceCandidate;
  callerId?: string;
}

interface CallbackTypes {
  onRemoteStream: (stream: MediaStream) => void;
  onIceCandidate: (candidate: RTCIceCandidate) => void;
  onCallState: (state: RTCPeerConnectionState | RTCIceConnectionState) => void;
}

const UserVideoCall: React.FC<UserVideoCallProps> = ({
  recipientId,
  onEndCall,
  incomingCallData,
}) => {
  const { incomingCallData: contextIncomingCallData } = useCall();
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoHidden, setIsVideoHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  const attachStreamToVideo = useCallback(
    (stream: MediaStream, videoElement: HTMLVideoElement | null) => {
      if (videoElement && stream) {
        try {
          console.log(
            `Attaching ${
              videoElement === localVideoRef.current ? "local" : "remote"
            } stream:`,
            stream.getTracks().map((t) => `${t.kind}:${t.enabled}`)
          );

          videoElement.srcObject = stream;
          videoElement.muted = videoElement === localVideoRef.current;

          const playPromise = videoElement.play();
          if (playPromise !== undefined) {
            playPromise.catch((error) => {
              if (error.name !== "AbortError") {
                console.error("Error playing video:", error);
              }
            });
          }
        } catch (error) {
          console.error("Error attaching stream to video:", error);
        }
      }
    },
    []
  );

  useEffect(() => {
    if (localStream && localVideoRef.current) {
      attachStreamToVideo(localStream, localVideoRef.current);
    }
  }, [localStream, attachStreamToVideo]);

  useEffect(() => {
    if (remoteStream && remoteVideoRef.current) {
      attachStreamToVideo(remoteStream, remoteVideoRef.current);
      setIsInitializing(false); // Set initializing to false when remote stream is attached
    }
  }, [remoteStream, attachStreamToVideo]);

  const handleEndCall = useCallback(() => {
    console.log("Ending call");
    userVideoCallService.disconnectCall();
    socketService.emit("userEndCall", { recipientId });
    setLocalStream(null);
    setRemoteStream(null);
    onEndCall();
  }, [recipientId, onEndCall]);

  useEffect(() => {
    let mounted = true;
    let callInitialized = false;

    const startCall = async () => {
      if (callInitialized) return;
      callInitialized = true;

      try {
        console.log("Starting call initialization...");

        // First get local stream
        const stream = await userVideoCallService.startLocalStream();
        if (!mounted) return;

        console.log("Local stream obtained:", stream.getTracks());
        setLocalStream(stream);

        // Set up remote stream handler
        userVideoCallService.setOnRemoteStreamUpdate((stream: MediaStream) => {
          if (!mounted) return;
          console.log("Remote stream received:", stream.getTracks());
          setRemoteStream(stream);
          setIsInitializing(false);
        });

        // Handle incoming or outgoing call
        const callData = incomingCallData || contextIncomingCallData;
        if (callData) {
          console.log("Handling incoming call...");
          await userVideoCallService.handleIncomingCall(callData.offer);
          const answer = await userVideoCallService.createAnswer();
          console.log("Created answer for incoming call");
          socketService.emitCallAnswer(callData.callerId, answer);
          setIsInitializing(false);
        } else {
          console.log("Initiating outgoing call...");
          const offer = await userVideoCallService.makeCall(recipientId);
          console.log("Created offer for outgoing call");
          socketService.emit("userCallOffer", { recipientId, offer });
        }

        // Set up socket event listeners
        const listeners = [
          socketService.onCallAccepted(() => {
            console.log("Call accepted, waiting for media");
            if (mounted) setIsInitializing(false);
          }),
          socketService.on(
            "userCallAnswer",
            async (data: { answerBase64: string }) => {
              console.log("Received call answer");
              await userVideoCallService.handleAnswer(data.answerBase64);
            }
          ),
        ];

        return () => {
          listeners.forEach((removeListener) => removeListener());
        };
      } catch (error) {
        console.error("Error in call setup:", error);
        if (mounted) {
          setError(
            `Failed to start video call: ${
              error instanceof Error ? error.message : "Unknown error"
            }`
          );
          setIsInitializing(false);
        }
      }
    };

    startCall();

    return () => {
      mounted = false;
      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
      }
      if (remoteStream) {
        remoteStream.getTracks().forEach((track) => track.stop());
      }
      userVideoCallService.disconnectCall();
    };
  }, [recipientId, incomingCallData, contextIncomingCallData]);

  const handleMuteToggle = () => {
    setIsMuted(!isMuted);
    userVideoCallService.muteAudio(!isMuted);
  };

  const handleVideoToggle = () => {
    setIsVideoHidden(!isVideoHidden);
    userVideoCallService.hideVideo(!isVideoHidden);
  };

  useEffect(() => {
    if (remoteStream && remoteVideoRef.current) {
      console.log("Attaching remote stream:", remoteStream.getTracks());
      remoteVideoRef.current.srcObject = remoteStream; // Ensure this is set correctly
      remoteVideoRef.current.play().catch((error) => {
        console.error("Error playing remote video:", error);
      });
    } else {
      console.log("No remote stream available to attach");
    }
  }, [remoteStream]);

  useEffect(() => {
    if (remoteStream && remoteVideoRef.current) {
      const videoElement = remoteVideoRef.current;

      const setupVideo = async () => {
        try {
          // Clear any existing srcObject
          videoElement.srcObject = null;

          // Set new srcObject
          videoElement.srcObject = remoteStream;
          videoElement.muted = false;

          // Wait for metadata to load
          await new Promise((resolve) => {
            const handleMetadata = () => {
              videoElement.removeEventListener(
                "loadedmetadata",
                handleMetadata
              );
              resolve(undefined);
            };
            videoElement.addEventListener("loadedmetadata", handleMetadata);
          });

          // Attempt to play with retry logic
          const attemptPlay = async (retries = 3) => {
            try {
              await videoElement.play();
              console.log("Remote video playing successfully");
            } catch (error) {
              if (
                error instanceof DOMException &&
                error.name === "AbortError" &&
                retries > 0
              ) {
                console.log("Play interrupted, retrying...", retries);
                await new Promise((resolve) => setTimeout(resolve, 1000));
                await attemptPlay(retries - 1);
              } else {
                console.error("Error playing remote video:", error);
              }
            }
          };

          await attemptPlay();
        } catch (error) {
          console.error("Error setting up remote video:", error);
        }
      };

      setupVideo();

      // Cleanup
      return () => {
        if (videoElement.srcObject) {
          videoElement.srcObject = null;
        }
      };
    }
  }, [remoteStream]);

  useEffect(() => {
    userVideoCallService.setOnRemoteStreamUpdate((stream: MediaStream) => {
      console.log(
        "Remote stream updated:",
        stream
          .getTracks()
          .map((track: MediaStreamTrack) => `${track.kind}:${track.enabled}`)
      );
      setRemoteStream(stream);
    });
  }, []);

  useEffect(() => {
    userVideoCallService.setOnIceCandidate((candidate: RTCIceCandidate) => {
      console.log("Sending ICE candidate to:", recipientId);
      socketService.emitIceCandidate(recipientId, candidate);
    });
  }, [recipientId]);

  useEffect(() => {
    userVideoCallService.setOnCallStateChange((state: string) => {
      console.log("Call state changed:", state);
      if (state === "failed" || state === "disconnected") {
        setError("Call connection failed. Please try again.");
        onEndCall();
      }
    });
  }, [onEndCall]);

  useEffect(() => {
    if (remoteStream) {
      console.log(
        "Remote stream tracks:",
        remoteStream.getTracks().map((track: MediaStreamTrack) => ({
          kind: track.kind,
          enabled: track.enabled,
          readyState: track.readyState,
          muted: track.muted,
        }))
      );

      remoteStream.getTracks().forEach((track: MediaStreamTrack) => {
        track.onended = () => console.log(`Track ${track.kind} ended`);
        track.onmute = () => console.log(`Track ${track.kind} muted`);
        track.onunmute = () => console.log(`Track ${track.kind} unmuted`);
      });
    }
  }, [remoteStream]);

  useEffect(() => {
    if (remoteStream && remoteVideoRef.current) {
      const videoElement = remoteVideoRef.current;
      let mounted = true;
      let playAttemptTimeout: NodeJS.Timeout | null = null;

      const setupVideo = async () => {
        if (!mounted) return;

        try {
          // First stop all tracks
          if (videoElement.srcObject) {
            const oldStream = videoElement.srcObject as MediaStream;
            oldStream.getTracks().forEach((track) => track.stop());
            videoElement.srcObject = null;
            videoElement.load();
            // Wait longer after cleanup
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }

          // Set up new stream
          videoElement.srcObject = remoteStream;
          videoElement.muted = false;
          videoElement.playsInline = true;
          videoElement.autoplay = true;

          // Simplified metadata loading
          const waitForMetadata = async (): Promise<void> => {
            if (videoElement.readyState >= 1) {
              return Promise.resolve();
            }

            return new Promise((resolve, reject) => {
              const timeout = setTimeout(() => {
                cleanup();
                resolve(); // Don't reject, just continue
              }, 2000);

              const metadataHandler = () => {
                cleanup();
                resolve();
              };

              const errorHandler = (e: Event) => {
                cleanup();
                console.warn("Metadata loading error:", e);
                resolve(); // Don't reject, just continue
              };

              const cleanup = () => {
                clearTimeout(timeout);
                videoElement.removeEventListener(
                  "loadedmetadata",
                  metadataHandler
                );
                videoElement.removeEventListener("error", errorHandler);
              };

              videoElement.addEventListener("loadedmetadata", metadataHandler);
              videoElement.addEventListener("error", errorHandler);
            });
          };

          // Wait for metadata
          await waitForMetadata();

          // Attempt playback with better error handling
          const attemptPlay = async (retries = 3): Promise<void> => {
            for (let i = retries; i >= 0; i--) {
              try {
                await videoElement.play();
                console.log("Remote video playing successfully");
                setIsInitializing(false);
                return;
              } catch (error) {
                if (
                  error instanceof DOMException &&
                  error.name === "AbortError" &&
                  i > 0
                ) {
                  console.log(
                    `Play attempt failed, retrying... (${i} attempts left)`
                  );
                  await new Promise((resolve) => setTimeout(resolve, 1000));
                  continue;
                }
                throw error;
              }
            }
          };

          await attemptPlay();

          // Set up track monitoring
          const trackHandlers = new Map();
          remoteStream.getTracks().forEach((track) => {
            const handlers = {
              ended: () => {
                console.log(`Track ${track.kind} ended`);
                if (mounted) {
                  void attemptPlay();
                }
              },
              mute: () => {
                console.log(`Track ${track.kind} muted`);
                if (mounted) {
                  void attemptPlay();
                }
              },
              unmute: () => console.log(`Track ${track.kind} unmuted`),
            };

            track.onended = handlers.ended;
            track.onmute = handlers.mute;
            track.onunmute = handlers.unmute;
            trackHandlers.set(track, handlers);
          });

          // Return cleanup function
          return () => {
            remoteStream.getTracks().forEach((track) => {
              const handlers = trackHandlers.get(track);
              if (handlers) {
                track.onended = null;
                track.onmute = null;
                track.onunmute = null;
              }
            });
          };
        } catch (error) {
          console.error("Error in video setup:", error);
          if (mounted) {
            setError("Failed to setup video stream. Please try again.");
          }
        }
      };

      void setupVideo();

      // Cleanup
      return () => {
        mounted = false;
        if (playAttemptTimeout) {
          clearTimeout(playAttemptTimeout);
        }
        if (videoElement.srcObject) {
          try {
            videoElement.pause();
            const tracks = (videoElement.srcObject as MediaStream).getTracks();
            tracks.forEach((track) => track.stop());
            videoElement.srcObject = null;
          } catch (error) {
            console.error("Error cleaning up video:", error);
          }
        }
      };
    }
  }, [remoteStream]);

  // Add this effect to monitor and fix video tracks
  useEffect(() => {
    if (remoteStream) {
      const videoTrack = remoteStream.getVideoTracks()[0];
      if (videoTrack) {
        // Ensure track is enabled
        videoTrack.enabled = true;

        // Log track capabilities
        console.log("Video track capabilities:", {
          settings: videoTrack.getSettings(),
          constraints: videoTrack.getConstraints(),
          enabled: videoTrack.enabled,
          readyState: videoTrack.readyState,
        });

        // Monitor track state
        const trackStateHandler = () => {
          console.log("Video track state changed:", {
            enabled: videoTrack.enabled,
            muted: videoTrack.muted,
            readyState: videoTrack.readyState,
          });

          // Re-enable track if it gets disabled
          if (!videoTrack.enabled) {
            videoTrack.enabled = true;
          }
        };

        videoTrack.onmute = trackStateHandler;
        videoTrack.onunmute = trackStateHandler;
        videoTrack.onended = trackStateHandler;

        return () => {
          videoTrack.onmute = null;
          videoTrack.onunmute = null;
          videoTrack.onended = null;
        };
      }
    }
  }, [remoteStream]);

  // Add this effect to handle video playback
  useEffect(() => {
    if (remoteStream && remoteVideoRef.current) {
      const videoElement = remoteVideoRef.current;
      let playAttemptTimeout: NodeJS.Timeout | null = null;

      const setupVideo = async () => {
        try {
          console.log("Setting up remote video with tracks:", 
            remoteStream.getTracks().map(t => ({
              kind: t.kind,
              enabled: t.enabled,
              muted: t.muted,
              readyState: t.readyState
            }))
          );

          // Clear existing stream
          if (videoElement.srcObject) {
            videoElement.pause();
            videoElement.srcObject = null;
            await new Promise(resolve => setTimeout(resolve, 100));
          }

          // Set up new stream
          videoElement.srcObject = remoteStream;
          videoElement.muted = false;
          videoElement.playsInline = true;
          videoElement.autoplay = true;

          // Wait for metadata
          await new Promise<void>((resolve, reject) => {
            const metadataHandler = () => {
              videoElement.removeEventListener('loadedmetadata', metadataHandler);
              resolve();
            };
            videoElement.addEventListener('loadedmetadata', metadataHandler);
            setTimeout(() => reject(new Error('Metadata timeout')), 5000);
          });

          console.log("Video metadata loaded, attempting playback");

          // Attempt playback with retries
          const attemptPlay = async (retries = 3): Promise<void> => {
            try {
              await videoElement.play();
              console.log('Remote video playing successfully');
            } catch (error) {
              if (error instanceof DOMException && retries > 0) {
                console.log(`Play attempt failed, retrying... (${retries} attempts left)`);
                await new Promise(resolve => setTimeout(resolve, 1000));
                return attemptPlay(retries - 1);
              }
              throw error;
            }
          };

          await attemptPlay();

          // Monitor video state
          const checkVideo = setInterval(() => {
            if (videoElement.paused || videoElement.ended) {
              console.log('Video playback interrupted, attempting to resume...');
              void attemptPlay();
            }
          }, 2000);

          return () => {
            clearInterval(checkVideo);
          };
        } catch (error) {
          console.error('Error setting up video:', error);
        }
      };

      void setupVideo();

      return () => {
        if (playAttemptTimeout) {
          clearTimeout(playAttemptTimeout);
        }
        if (videoElement.srcObject) {
          videoElement.pause();
          videoElement.srcObject = null;
        }
      };
    }
  }, [remoteStream]);

  if (error) {
    return (
      <div className="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg shadow-xl p-6 text-center">
          <h2 className="text-2xl font-bold mb-4">Error</h2>
          <p className="mb-6">{error}</p>
          <button
            onClick={onEndCall}
            className="bg-red-500 text-white px-4 py-2 rounded-lg"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl p-4">
        <div className="relative w-full" style={{ paddingBottom: "56.25%" }}>
          {" "}
          {/* 16:9 aspect ratio */}
          <div className="absolute inset-0 bg-black rounded-lg overflow-hidden">
            {remoteStream ? (
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                  backgroundColor: "#000",
                  transform: isVideoHidden ? "scale(0)" : "none",
                }}
                className="w-full h-full"
                muted={false}
                onLoadedMetadata={() => {
                  console.log('Video metadata loaded');
                  const videoElement = remoteVideoRef.current;
                  if (videoElement) {
                    videoElement.play().catch(error => {
                      console.warn('Initial play failed:', error);
                    });
                  }
                }}
                onPlay={() => console.log('Video playback started')}
                onError={(e) => {
                  const videoElement = e.target as HTMLVideoElement;
                  console.error('Video error:', {
                    error: videoElement.error,
                    readyState: videoElement.readyState,
                    networkState: videoElement.networkState
                  });
                }}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-white">
                {isInitializing
                  ? "Initializing call..."
                  : "Waiting for other participant..."}
              </div>
            )}
          </div>
          {localStream && (
            <div
              className="absolute bottom-4 right-4 w-1/4"
              style={{ aspectRatio: "4/3" }}
            >
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  borderRadius: "0.5rem",
                  transform: "scaleX(-1)",
                  border: "2px solid white",
                  backgroundColor: "#000",
                }}
              />
            </div>
          )}
        </div>
        <div className="flex justify-center space-x-4">
          <button
            onClick={handleMuteToggle}
            className={`p-2 rounded-full ${
              isMuted ? "bg-red-500" : "bg-gray-500"
            }`}
          >
            {isMuted ? "Unmute" : "Mute"}
          </button>
          <button
            onClick={handleVideoToggle}
            className={`p-2 rounded-full ${
              isVideoHidden ? "bg-red-500" : "bg-gray-500"
            }`}
          >
            {isVideoHidden ? "Show Video" : "Hide Video"}
          </button>
          <button
            onClick={onEndCall}
            className="bg-red-500 text-white p-2 rounded-full"
          >
            End Call
          </button>
        </div>
      </div>
    </div>
  );
};

export default UserVideoCall;
