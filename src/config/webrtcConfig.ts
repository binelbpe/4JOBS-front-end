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
    
    const response = await fetch(
      `${process.env.REACT_APP_API_BASE_URL}/api/twilio-token`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json"
        },
        credentials: 'include'
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const twilioData: TwilioResponse = await response.json();
    console.log("Received Twilio configuration:", {
      hasIceServers: twilioData.ice_servers?.length > 0,
      iceServerTypes: twilioData.ice_servers?.map(server => 
        server.urls.toString().includes('turn:') ? 'TURN' : 'STUN'
      ),
      username: twilioData.username ? 'present' : 'missing',
      ttl: twilioData.ttl,
      hasToken: !!twilioData.token,
      hasRoomName: !!twilioData.roomName
    });

    const config: RTCConfiguration = {
      iceServers: twilioData.ice_servers.map((server: TwilioIceServer) => ({
        urls: server.urls,
        username: server.username || twilioData.username,
        credential: server.credential || twilioData.password
      })),
      iceCandidatePoolSize: 10,
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
      iceTransportPolicy: "relay" // Force TURN usage in production
    };

    console.log('Created WebRTC configuration with:', {
      iceServers: config.iceServers?.length || 0,
      iceTransportPolicy: config.iceTransportPolicy,
      usingTwilio: true
    });

    return config;
  } catch (error) {
    console.error("Error getting Twilio config:", error);
    console.log('Using fallback configuration without Twilio');
    return {
      iceServers: [
        { urls: "stun:stun1.l.google.com:19302" }
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
    const response = await fetch(
      `${process.env.REACT_APP_API_BASE_URL}/api/twilio-token`,
      {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    console.log("Twilio connection verified:", {
      hasToken: !!data.token,
      hasIceServers: data.iceServers?.length > 0,
      roomName: data.roomName,
    });

    return true;
  } catch (error) {
    console.error("Twilio connection verification failed:", error);
    return false;
  }
};
