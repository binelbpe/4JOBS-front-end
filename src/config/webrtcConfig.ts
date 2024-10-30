// Function to get Twilio credentials
const getTwilioConfig = async (): Promise<RTCConfiguration> => {
  try {
    const apiUrl = process.env.REACT_APP_API_BASE_URL;
    const tokenEndpoint = process.env.REACT_APP_TWILIO_TOKEN_ENDPOINT;
    
    if (!apiUrl || !tokenEndpoint) {
      throw new Error('Missing API configuration');
    }

    const response = await fetch(`${apiUrl}${tokenEndpoint}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      },
      credentials: 'include'
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const twilioData = await response.json();

    return {
      iceServers: [
        { urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] },
        ...(twilioData.iceServers || []).map((server: any) => ({
          urls: server.url || server.urls,
          username: server.username || '',
          credential: server.credential || ''
        }))
      ],
      iceCandidatePoolSize: 10,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
      iceTransportPolicy: 'relay' // Force TURN usage in production
    };
  } catch (error) {
    console.error('Error getting Twilio configuration:', error);
    throw error;
  }
};

// Export the base configuration
export const webRTCConfig: RTCConfiguration = {
  iceServers: [
    { urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] }
  ],
  iceCandidatePoolSize: 10,
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
  iceTransportPolicy: 'all'
};

export const getWebRTCConfig = getTwilioConfig;
