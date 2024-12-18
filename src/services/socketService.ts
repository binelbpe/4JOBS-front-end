import { io, Socket } from "socket.io-client";

import store from "../redux/store";

import { addMessage, setTypingStatus } from "../redux/slices/userMessageSlice";

class SocketService {
  private socket: Socket | null = null;
  private userId: string | null = null;
  private connected: boolean = false;

  connect(userId: string) {

    this.userId = userId;

    if (this.socket && this.socket.connected) {
      this.socket.disconnect();
    }

    const socketUrl = process.env.REACT_APP_SOCKET_URL ;

    this.socket = io(socketUrl, {
      path: '/user-socket',
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      auth: { userId, userType: 'user' },
    });

    this.setupEventListeners();
  }

  private setupEventListeners() {
    if (!this.socket) return;

    this.socket.on("connect", () => {
      this.connected = true;
    });

    this.socket.on("connect_error", (error) => {
      console.error("Socket connection error:", error);
      this.connected = false;
    });

    this.socket.on("disconnect", (reason) => {
      this.connected = false;
    });

    this.socket.on("newMessage", (message: any) => {
      store.dispatch(addMessage(message));
    });

    this.socket.on("messageSent", (message: any) => {
      store.dispatch(addMessage(message));
    });

    this.socket.on("userTyping", ({ userId, isTyping }: { userId: string; isTyping: boolean }) => {
      store.dispatch(setTypingStatus({ userId, isTyping }));
    });

    this.socket.on("messageError", (error: any) => {
      console.error("Error sending message:", error);
    });
  }

  sendMessage(message: { senderId: string, recipientId: string, content: string }) {
    if (this.socket && this.connected) {
      this.socket.emit("sendMessage", message, (response: any) => {
        if (response.error) {
          console.error("Error sending message:", response.error);
        } else {
        }
      });
    } else {
      console.warn("SocketService: Socket is not connected. Unable to send message.");
    }
  }

  emitTyping(recipientId: string, isTyping: boolean) {
    if (this.socket && this.connected) {
      this.socket.emit("typing", { recipientId, isTyping });
    } else {
      console.warn("SocketService: Socket is not connected. Unable to emit typing status.");
    }
  }

  emit(event: string, data: any) {
    if (this.socket && this.connected) {
      this.socket.emit(event, data);
    } else {
      console.warn(`SocketService: Cannot emit ${event}. Socket is not connected.`);
    }
  }

  on(event: string, callback: (...args: any[]) => void): () => void {
    if (this.socket) {
      this.socket.on(event, callback);
      return () => this.socket?.off(event, callback);
    }
    return () => {};
  }

  getConnectionStatus(): boolean {
    return this.connected;
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.connected = false;
  }

  markNotificationAsRead(notificationId: string) {
    if (this.socket && this.connected) {
      this.socket.emit("markNotificationAsRead", notificationId);
    } else {
      console.warn("SocketService: Socket is not connected. Unable to mark notification as read.");
    }
  }

 
}

export const socketService = new SocketService();
