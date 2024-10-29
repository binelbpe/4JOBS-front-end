export const webRTCConfig: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    {
      urls: process.env.REACT_APP_TURN_SERVER || 'turn:your-turn-server.com:3478',
      username: process.env.REACT_APP_TURN_USERNAME || 'your-username',
      credential: process.env.REACT_APP_TURN_CREDENTIAL || 'your-password'
    }
  ],
  iceCandidatePoolSize: 10,
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
  iceTransportPolicy: 'all'
};
