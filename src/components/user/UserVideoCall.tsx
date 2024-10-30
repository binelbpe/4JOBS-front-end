import React, { useState, useEffect, useRef, useCallback } from 'react';
import { userVideoCallService } from '../../services/userVideoCallService';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faMicrophone, faMicrophoneSlash, faVideo, faVideoSlash, faPhone } from '@fortawesome/free-solid-svg-icons';
import { socketService } from '../../services/socketService';
import { useCall } from '../../contexts/CallContext';

interface UserVideoCallProps {
  recipientId: string;
  onEndCall: () => void;
  incomingCallData?: { callerId: string, offer: string } | null;
}

interface IceData {
  candidate: RTCIceCandidate;
  callerId?: string;
}

const UserVideoCall: React.FC<UserVideoCallProps> = ({ recipientId, onEndCall, incomingCallData }) => {
  const { incomingCallData: contextIncomingCallData } = useCall();
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoHidden, setIsVideoHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  const attachStreamToVideo = useCallback((stream: MediaStream, videoElement: HTMLVideoElement | null) => {
    if (videoElement && stream) {
      try {
        console.log(`Attaching ${videoElement === localVideoRef.current ? 'local' : 'remote'} stream:`, 
          stream.getTracks().map(t => `${t.kind}:${t.enabled}`));
        
        videoElement.srcObject = stream;
        videoElement.muted = videoElement === localVideoRef.current;
        
        const playPromise = videoElement.play();
        if (playPromise !== undefined) {
          playPromise.catch(error => {
            if (error.name !== 'AbortError') {
              console.error("Error playing video:", error);
            }
          });
        }
      } catch (error) {
        console.error("Error attaching stream to video:", error);
      }
    }
  }, []);

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
        userVideoCallService.setOnRemoteStreamUpdate((stream) => {
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
          socketService.on("userCallAnswer", async (data: { answerBase64: string }) => {
            console.log("Received call answer");
            await userVideoCallService.handleAnswer(data.answerBase64);
          })
        ];

        return () => {
          listeners.forEach(removeListener => removeListener());
        };
      } catch (error) {
        console.error("Error in call setup:", error);
        if (mounted) {
          setError(`Failed to start video call: ${error instanceof Error ? error.message : 'Unknown error'}`);
          setIsInitializing(false);
        }
      }
    };

    startCall();

    return () => {
      mounted = false;
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
      if (remoteStream) {
        remoteStream.getTracks().forEach(track => track.stop());
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
      console.log('Attaching remote stream:', remoteStream.getTracks());
      remoteVideoRef.current.srcObject = remoteStream; // Ensure this is set correctly
      remoteVideoRef.current.play().catch(error => {
        console.error("Error playing remote video:", error);
      });
    } else {
      console.log('No remote stream available to attach');
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
              videoElement.removeEventListener('loadedmetadata', handleMetadata);
              resolve(undefined);
            };
            videoElement.addEventListener('loadedmetadata', handleMetadata);
          });

          // Attempt to play with retry logic
          const attemptPlay = async (retries = 3) => {
            try {
              await videoElement.play();
              console.log('Remote video playing successfully');
            } catch (error) {
              if (error instanceof DOMException && error.name === 'AbortError' && retries > 0) {
                console.log('Play interrupted, retrying...', retries);
                await new Promise(resolve => setTimeout(resolve, 1000));
                await attemptPlay(retries - 1);
              } else {
                console.error('Error playing remote video:', error);
              }
            }
          };

          await attemptPlay();
        } catch (error) {
          console.error('Error setting up remote video:', error);
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
    userVideoCallService.setOnRemoteStreamUpdate((stream) => {
      console.log('Remote stream updated:', stream.getTracks().map(t => `${t.kind}:${t.enabled}`));
      setRemoteStream(stream);
    });

    // ... rest of the effect code ...
  }, [recipientId, onEndCall, incomingCallData]);

  useEffect(() => {
    // Add ICE candidate handling
    const handleIceCandidate = socketService.onIceCandidate(async (data) => {
      try {
        if (data.candidate) {
          const candidateString = Buffer.from(JSON.stringify(data.candidate)).toString('base64');
          await userVideoCallService.handleIceCandidate(candidateString);
        }
      } catch (error) {
        console.error('Error handling ICE candidate:', error);
      }
    });

    return () => {
      handleIceCandidate(); // Cleanup listener
    };
  }, []);

  // Update ICE candidate handling
  useEffect(() => {
    const handleIncomingIce = socketService.onIceCandidate(async (data: IceData) => {
      try {
        if (data.candidate) {
          console.log('Received ICE candidate:', data.candidate);
          await userVideoCallService.handleIceCandidate(
            btoa(JSON.stringify(data.candidate))
          );
        }
      } catch (error) {
        console.error('Error handling ICE candidate:', error);
      }
    });

    userVideoCallService.setOnIceCandidate((candidate) => {
      console.log('Sending ICE candidate to:', recipientId);
      socketService.emitIceCandidate(recipientId, candidate);
    });

    return () => {
      handleIncomingIce();
    };
  }, [recipientId]);

  // Add call state monitoring
  useEffect(() => {
    userVideoCallService.setOnCallStateChange((state) => {
      console.log('Call state changed:', state);
      if (state === 'failed' || state === 'disconnected') {
        setError('Call connection failed. Please try again.');
        onEndCall();
      }
    });
  }, [onEndCall]);

  // Add this effect to monitor remote stream changes
  useEffect(() => {
    if (remoteStream) {
      console.log('Remote stream tracks:', remoteStream.getTracks().map(track => ({
        kind: track.kind,
        enabled: track.enabled,
        readyState: track.readyState,
        muted: track.muted
      })));
      
      remoteStream.getTracks().forEach(track => {
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
            oldStream.getTracks().forEach(track => track.stop());
            videoElement.srcObject = null;
            videoElement.load();
            // Wait longer after cleanup
            await new Promise(resolve => setTimeout(resolve, 1000));
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
                console.warn('Metadata loading error:', e);
                resolve(); // Don't reject, just continue
              };

              const cleanup = () => {
                clearTimeout(timeout);
                videoElement.removeEventListener('loadedmetadata', metadataHandler);
                videoElement.removeEventListener('error', errorHandler);
              };

              videoElement.addEventListener('loadedmetadata', metadataHandler);
              videoElement.addEventListener('error', errorHandler);
            });
          };

          // Wait for metadata
          await waitForMetadata();

          // Attempt playback with better error handling
          const attemptPlay = async (retries = 3): Promise<void> => {
            for (let i = retries; i >= 0; i--) {
              try {
                await videoElement.play();
                console.log('Remote video playing successfully');
                setIsInitializing(false);
                return;
              } catch (error) {
                if (error instanceof DOMException && error.name === 'AbortError' && i > 0) {
                  console.log(`Play attempt failed, retrying... (${i} attempts left)`);
                  await new Promise(resolve => setTimeout(resolve, 1000));
                  continue;
                }
                throw error;
              }
            }
          };

          await attemptPlay();

          // Set up track monitoring
          const trackHandlers = new Map();
          remoteStream.getTracks().forEach(track => {
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
              unmute: () => console.log(`Track ${track.kind} unmuted`)
            };

            track.onended = handlers.ended;
            track.onmute = handlers.mute;
            track.onunmute = handlers.unmute;
            trackHandlers.set(track, handlers);
          });

          // Return cleanup function
          return () => {
            remoteStream.getTracks().forEach(track => {
              const handlers = trackHandlers.get(track);
              if (handlers) {
                track.onended = null;
                track.onmute = null;
                track.onunmute = null;
              }
            });
          };

        } catch (error) {
          console.error('Error in video setup:', error);
          if (mounted) {
            setError('Failed to setup video stream. Please try again.');
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
            tracks.forEach(track => track.stop());
            videoElement.srcObject = null;
          } catch (error) {
            console.error('Error cleaning up video:', error);
          }
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
        <div className="relative aspect-w-16 aspect-h-9 mb-4">
          <div className="w-full h-full bg-black rounded-lg overflow-hidden">
            {remoteStream ? (
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                style={{ 
                  width: '100%', 
                  height: '100%', 
                  objectFit: 'cover',
                  transform: 'scaleX(-1)' // Mirror the video
                }}
                className="w-full h-full"
                muted={false}
                onLoadedMetadata={() => console.log('Video metadata loaded')}
                onPlay={() => console.log('Video playback started')}
                onPause={() => console.log('Video playback paused')}
                onError={(e) => {
                  const videoElement = e.target as HTMLVideoElement;
                  console.error('Video error:', {
                    code: videoElement.error?.code,
                    message: videoElement.error?.message,
                    timestamp: new Date().toISOString()
                  });
                }}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-white">
                {isInitializing ? "Initializing call..." : "Waiting for other participant..."}
              </div>
            )}
          </div>
          {localStream && (
            <div className="absolute bottom-4 right-4 w-1/4 h-1/4">
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover rounded-lg border-2 border-white"
              />
            </div>
          )}
        </div>
        <div className="flex justify-center space-x-4">
          <button
            onClick={handleMuteToggle}
            className={`p-3 rounded-full ${isMuted ? 'bg-red-500' : 'bg-gray-200'}`}
          >
            <FontAwesomeIcon icon={isMuted ? faMicrophoneSlash : faMicrophone} className="text-xl" />
          </button>
          <button
            onClick={handleVideoToggle}
            className={`p-3 rounded-full ${isVideoHidden ? 'bg-red-500' : 'bg-gray-200'}`}
          >
            <FontAwesomeIcon icon={isVideoHidden ? faVideoSlash : faVideo} className="text-xl" />
          </button>
          <button
            onClick={handleEndCall}
            className="p-3 rounded-full bg-red-500 text-white"
          >
            <FontAwesomeIcon icon={faPhone} className="text-xl transform rotate-135" />
          </button>
          <button onClick={() => {
            console.log('Current remote stream tracks:', remoteStream?.getTracks().map(t => `${t.kind}:${t.enabled}`));
          }}>
            Log Remote Stream
          </button>
        </div>
      </div>
    </div>
  );
};

export default UserVideoCall;
