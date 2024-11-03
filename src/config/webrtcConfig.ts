import { connect, createLocalTracks, Room } from "twilio-video";

interface TwilioIceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

interface TwilioResponse {
  username: string;
  ice_servers: TwilioIceServer[];
  ttl: string;
  date_created: string;
  date_updated: string;
  account_sid: string;
  password: string;
  token?: string;
  roomName?: string;
}

const getTwilioConfig = async (): Promise<RTCConfiguration> => {
  try {
    console.log('Fetching Twilio configuration...');
    
    const API_URL = process.env.REACT_APP_API_BASE_URL || 'https://your-production-api.com';
    
    const response = await fetch(
      `${API_URL}/api/twilio-token`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json"
        },
        credentials: 'include',
        signal: AbortSignal.timeout(10000)
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const twilioData: TwilioResponse = await response.json();

    const config: RTCConfiguration = {
      iceServers: twilioData.ice_servers.map((server: TwilioIceServer) => ({
        urls: server.urls,
        username: server.username || twilioData.username,
        credential: server.credential || twilioData.password
      })),
      iceCandidatePoolSize: 10,
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
      iceTransportPolicy: "all"
    };

    return config;
  } catch (error) {
    console.error("Error getting Twilio config:", error);
    return {
      iceServers: [
        { 
          urls: [
            "stun:stun1.l.google.com:19302",
            "stun:stun2.l.google.com:19302",
            "stun:stun3.l.google.com:19302"
          ]
        }
      ],
      iceCandidatePoolSize: 10,
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
      iceTransportPolicy: "all"
    };
  }
};

export const getWebRTCConfig = getTwilioConfig;

export const connectToTwilioRoom = async (identity: string): Promise<Room> => {
  try {
    const response = await Promise.race([
      fetch(
        `${process.env.REACT_APP_API_BASE_URL}/api/twilio-token?identity=${identity}`,
        {
          method: "GET",
          headers: { 
            "Content-Type": "application/json",
          },
          credentials: 'include'
        }
      ),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Request timeout')), 10000)
      )
    ]) as Response;

    if (!response.ok) {
      throw new Error("Failed to get Twilio token");
    }

    const data: TwilioResponse = await response.json();

    if (!data.token || !data.roomName) {
      throw new Error("Missing token or room name in response");
    }

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
    if (error instanceof TypeError) {
      throw new Error("Network connection error. Please check your internet connection.");
    }
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

export const verifyTwilioConnection = async (): Promise<boolean> => {
  try {
    const response = await Promise.race([
      fetch(
        `${process.env.REACT_APP_API_BASE_URL}/api/twilio-token`,
        {
          method: "GET",
          headers: { 
            "Content-Type": "application/json" 
          },
          credentials: 'include'
        }
      ),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Connection timeout')), 5000)
      )
    ]) as Response;

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json() as TwilioResponse;
    if (!data.ice_servers || data.ice_servers.length === 0) {
      console.warn("No ICE servers received from Twilio");
      return false;
    }

    return true;
  } catch (error) {
    console.error("Twilio connection verification failed:", error);
    return false;
  }
};
