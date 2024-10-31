import { connect, createLocalTracks, Room } from "twilio-video";

interface TwilioResponse {
  token: string;
  roomName: string;
  roomSid: string;
  expires: number;
  iceServers: RTCIceServer[];
}

export const getWebRTCConfig = async (): Promise<RTCConfiguration> => {
  try {
    const response = await fetch(
      `${process.env.REACT_APP_API_BASE_URL}/api/twilio-token`,
      {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        credentials: 'include' // Include cookies if needed
      }
    );

    if (!response.ok) {
      throw new Error("Failed to get Twilio token");
    }

    const data: TwilioResponse = await response.json();
    console.log('Received Twilio config:', data);

    if (!data.iceServers || data.iceServers.length === 0) {
      throw new Error('No ICE servers received from Twilio');
    }

    return {
      iceServers: [
        ...data.iceServers,
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" }
      ],
      iceCandidatePoolSize: 10,
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
      iceTransportPolicy: "all"
    };
  } catch (error) {
    console.error("Error getting Twilio config:", error);
    // Return fallback configuration
    return {
      iceServers: [
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" }
      ],
      iceCandidatePoolSize: 10,
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
      iceTransportPolicy: "all"
    };
  }
};

export const connectToTwilioRoom = async (identity: string): Promise<Room> => {
  try {
    const response = await fetch(
      `${process.env.REACT_APP_API_BASE_URL}/api/twilio-token?identity=${identity}`,
      {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      }
    );

    if (!response.ok) {
      throw new Error("Failed to get Twilio token");
    }

    const data: TwilioResponse = await response.json();

    // Create local tracks
    const localTracks = await createLocalTracks({
      audio: true,
      video: { width: 640, height: 480 },
    });

    // Connect to the room
    const room = await connect(data.token, {
      name: data.roomName,
      tracks: localTracks,
      dominantSpeaker: true,
    });

    return room;
  } catch (error) {
    console.error("Error connecting to Twilio room:", error);
    throw error;
  }
};

export const disconnectFromRoom = async (roomSid: string): Promise<void> => {
  try {
    await fetch(
      `${process.env.REACT_APP_API_BASE_URL}/api/rooms/${roomSid}/end`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error disconnecting from room:", error);
  }
};
