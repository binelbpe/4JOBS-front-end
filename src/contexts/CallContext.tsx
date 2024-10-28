import React, { createContext, useState, useContext, useCallback, ReactNode, useEffect } from 'react';
import { socketService } from '../services/socketService';

interface CallContextType {
  isIncomingCall: boolean;
  incomingCallData: { callerId: string; offer: string } | null;
  isCallActive: boolean;
  handleIncomingCall: (data: { callerId: string; offer: string }) => void;
  acceptCall: () => void;
  rejectCall: () => void;
  setupVideoCall: (recipientId: string) => void;
  endCall: () => void;
}

const CallContext = createContext<CallContextType | undefined>(undefined);

interface CallProviderProps {
  children: ReactNode;
}

export const CallProvider: React.FC<CallProviderProps> = ({ children }) => {
  const [isIncomingCall, setIsIncomingCall] = useState(false);
  const [incomingCallData, setIncomingCallData] = useState<{ callerId: string; offer: string } | null>(null);
  const [isCallActive, setIsCallActive] = useState(false);
  const [isCallInitialized, setIsCallInitialized] = useState(false);

  const handleIncomingCall = useCallback((data: { callerId: string; offer: string }) => {
    console.log("Incoming call from:", data.callerId);
    // Ensure we're not already in a call
    if (!isCallActive && !isCallInitialized) {
      setIsIncomingCall(true);
      setIncomingCallData(data);
    } else {
      console.log("Call rejected - already in a call");
      socketService.emit("rejectCall", { callerId: data.callerId });
    }
  }, [isCallActive, isCallInitialized]);

  const acceptCall = useCallback(() => {
    console.log("Call accepted in CallContext");
    if (incomingCallData?.callerId) {
      console.log("Emitting call accepted to:", incomingCallData.callerId);
      socketService.emitCallAccepted(incomingCallData.callerId);
      setIsIncomingCall(false);
      setIsCallActive(true);
      setIsCallInitialized(true);
    }
  }, [incomingCallData]);

  const rejectCall = useCallback(() => {
    console.log("Call rejected in CallContext");
    if (incomingCallData) {
      socketService.emit("rejectCall", { callerId: incomingCallData.callerId });
      setIsIncomingCall(false);
      setIncomingCallData(null);
    }
  }, [incomingCallData]);

  const setupVideoCall = useCallback((recipientId: string) => {
    if (isCallInitialized) {
      console.log("Call already initialized");
      return;
    }
    
    console.log(`Setting up video call with ${recipientId}`);
    
    // Reset any existing call state
    setIsCallActive(false);
    setIsCallInitialized(false);
    setIncomingCallData(null);
    
    // Start new call
    setIsCallActive(true);
    setIsCallInitialized(true);

    const timeoutId = setTimeout(() => {
      console.log("Checking call status...");
      if (!isCallActive) {
        console.log("Call setup timed out");
        setIsCallInitialized(false);
        setIsCallActive(false);
        setIncomingCallData(null);
      }
    }, 30000);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [isCallInitialized, isCallActive]);

  const endCall = useCallback(() => {
    console.log("Call ended in CallContext");
    setIsCallActive(false);
    setIncomingCallData(null);
    setIsCallInitialized(false);
    setIsIncomingCall(false);
  }, []);

  // Add cleanup on unmount
  useEffect(() => {
    return () => {
      setIsCallActive(false);
      setIncomingCallData(null);
      setIsCallInitialized(false);
      setIsIncomingCall(false);
    };
  }, []);

  return (
    <CallContext.Provider value={{ 
      isIncomingCall, 
      incomingCallData, 
      isCallActive,
      handleIncomingCall, 
      acceptCall, 
      rejectCall,
      setupVideoCall,
      endCall
    }}>
      {children}
    </CallContext.Provider>
  );
};

export const useCall = () => {
  const context = useContext(CallContext);
  if (context === undefined) {
    throw new Error('useCall must be used within a CallProvider');
  }
  return context;
};
