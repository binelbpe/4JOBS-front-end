// Function to get Twilio credentials
const getTwilioConfig = async (): Promise<RTCConfiguration> => {
  try {
    const apiUrl = process.env.REACT_APP_API_BASE_URL;
    const tokenEndpoint = process.env.REACT_APP_TWILIO_TOKEN_ENDPOINT || '/api/twilio-token';
    
    if (!apiUrl || !tokenEndpoint) {
      console.warn('Missing API URL or token endpoint configuration, using fallback');
      return webRTCConfig;
    }

    console.log('Fetching Twilio config from:', `${apiUrl}${tokenEndpoint}`);
    
    const response = await fetch(`${apiUrl}${tokenEndpoint}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const twilioData = await response.json();
    console.log('Received Twilio config:', twilioData);

    // Return a complete RTCConfiguration
    return {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        ...(twilioData.iceServers || []).map((server: any) => ({
          urls: server.url || server.urls,
          username: server.username || '',
          credential: server.credential || ''
        }))
      ],
      iceCandidatePoolSize: 10,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
      iceTransportPolicy: 'all'
    };
  } catch (error) {
    console.error('Error getting Twilio configuration:', error);
    return webRTCConfig;
  }
};

// Export the base configuration
export const webRTCConfig: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
  iceCandidatePoolSize: 10,
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
  iceTransportPolicy: 'all'
};

export const getWebRTCConfig = getTwilioConfig;
