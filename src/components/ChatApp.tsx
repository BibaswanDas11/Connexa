import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { Search, Send, User, MessageCircle, LogOut, Check, CheckCheck, X, Users, UserPlus, Trash2, Settings, Save, ChevronLeft, Plus, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { db, auth } from '../lib/firebase';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  doc, 
  getDocs, 
  getDoc,
  setDoc,
  deleteDoc,
  orderBy,
  limit,
  serverTimestamp,
  Timestamp,
  collectionGroup
} from 'firebase/firestore';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

interface ChatMessage {
  id: string;
  senderId: string;
  senderName?: string;
  senderAvatar?: string | null;
  receiverId?: string;
  chatId?: string;
  content: string;
  createdAt: string;
  readReceipt: number;
  isForwarded?: boolean;
}

interface UserProfile {
  id: string;
  username: string;
  connexaId: string;
  online_status: number;
  avatarUrl?: string | null;
  status?: 'pending' | 'accepted' | 'blocked';
  relation?: 'pending' | 'accepted' | 'blocked' | null;
  type?: 'dm';
}

const Toast = ({ message, type, onClose }: { message: string, type: 'success' | 'error' | 'info', onClose: () => void }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className={cn(
        "fixed bottom-20 left-1/2 -translate-x-1/2 z-[100] px-6 py-3 rounded-2xl shadow-xl border flex items-center gap-2",
        type === 'success' ? "bg-green-500 border-green-400 text-white" : 
        type === 'error' ? "bg-red-500 border-red-400 text-white" : 
        "bg-slate-800 border-slate-700 text-white"
      )}
    >
      {type === 'success' && <Check className="w-4 h-4" />}
      {type === 'error' && <X className="w-4 h-4" />}
      <span className="text-xs font-bold">{message}</span>
    </motion.div>
  );
};

interface Group {
  id: string;
  name: string;
  type: 'group';
  avatarUrl?: string | null;
  createdBy: string;
}

type ChatTarget = UserProfile | Group;

type MobileView = 'chats' | 'chat_room' | 'profile' | 'settings';

const AVATAR_OPTIONS = [
  'https://api.dicebear.com/7.x/shapes/svg?seed=Lucky',
  'https://api.dicebear.com/7.x/shapes/svg?seed=Felix',
  'https://api.dicebear.com/7.x/shapes/svg?seed=Mimi',
  'https://api.dicebear.com/7.x/shapes/svg?seed=Coco',
  'https://api.dicebear.com/7.x/shapes/svg?seed=Ginger',
  'https://api.dicebear.com/7.x/shapes/svg?seed=Pepper',
  'https://api.dicebear.com/7.x/shapes/svg?seed=Bear',
];

export default function ChatApp() {
  const { user, updateUser, logout } = useAuth();
  const [searchId, setSearchId] = useState('');
  const [searchResults, setSearchResults] = useState<UserProfile[]>([]);
  const [selectedChat, setSelectedChat] = useState<ChatTarget | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [chats, setChats] = useState<UserProfile[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [pendingRequests, setPendingRequests] = useState<UserProfile[]>([]);
  const [mobileView, setMobileView] = useState<MobileView>('chats');
  const [showGroupCreate, setShowGroupCreate] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [selectedGroupMembers, setSelectedGroupMembers] = useState<string[]>([]);
  const [currentGroupMembers, setCurrentGroupMembers] = useState<UserProfile[]>([]);
  const [showGroupSettings, setShowGroupSettings] = useState(false);
  const [editGroupName, setEditGroupName] = useState('');
  const [selectedGroupAvatar, setSelectedGroupAvatar] = useState(AVATAR_OPTIONS[0]);
  const scrollRef = useRef<HTMLDivElement>(null);
  
  // Profile Editing State
  const [editUsername, setEditUsername] = useState(user?.username || '');
  const [selectedAvatar, setSelectedAvatar] = useState(user?.avatarUrl || AVATAR_OPTIONS[0]);
  const [notificationsEnabled, setNotificationsEnabled] = useState(user?.notificationEnabled === 1);
  const [isSaving, setIsSaving] = useState(false);
  const [showSavedMessage, setShowSavedMessage] = useState(false);
  const [forwardingMessage, setForwardingMessage] = useState<ChatMessage | null>(null);
  const [showForwardModal, setShowForwardModal] = useState(false);
  const [friendRequestLoading, setFriendRequestLoading] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' | 'info' } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const groupFileInputRef = useRef<HTMLInputElement>(null);

  const compressAndSetImage = (file: File, callback: (base64: string) => void) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 200;
        const MAX_HEIGHT = 200;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
        callback(dataUrl);
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      compressAndSetImage(file, setSelectedAvatar);
    }
  };

  const handleGroupFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      compressAndSetImage(file, setSelectedGroupAvatar);
    }
  };

  // Initialize: Load friends and pending requests
  useEffect(() => {
    if (!user) return;
    
    // Listen for Friends
    const friendsQuery = query(collection(db, 'users', user.id, 'friends'), where('status', 'in', ['accepted', 'blocked']));
    const unsubscribeFriends = onSnapshot(friendsQuery, async (snapshot) => {
      const friendsData = await Promise.all(snapshot.docs.map(async (d) => {
        const friendData = d.data();
        // Fetch friend profile for username/avatar
        const userDoc = await getDoc(doc(db, 'users', friendData.friendId));
        return {
          id: friendData.friendId,
          ...userDoc.data(),
          status: friendData.status
        } as UserProfile;
      }));
      setChats(friendsData);
    }, (err) => handleFirestoreError(err, OperationType.LIST, `users/${user.id}/friends`));

    // Listen for Groups
    const groupsQuery = query(collection(db, 'chats'), where('memberIds', 'array-contains', user.id));
    const unsubscribeGroups = onSnapshot(groupsQuery, (snapshot) => {
      const groupsData = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Group));
      setGroups(groupsData);
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'chats'));

    // Listen for Pending Requests
    const pendingQuery = query(collection(db, 'users', user.id, 'friends'), where('status', '==', 'pending'));
    const unsubscribePending = onSnapshot(pendingQuery, async (snapshot) => {
      const pendingData = await Promise.all(snapshot.docs.map(async (d) => {
        const friendData = d.data();
        const userDoc = await getDoc(doc(db, 'users', friendData.userId));
        return {
          id: friendData.userId,
          ...userDoc.data()
        } as UserProfile;
      }));
      setPendingRequests(pendingData);
      if (pendingData.length > 0) {
        setToast({ message: "You have new friend requests!", type: 'info' });
      }
    }, (err) => handleFirestoreError(err, OperationType.LIST, `users/${user.id}/friends`));

    setEditUsername(user.username);
    if (user.avatarUrl) setSelectedAvatar(user.avatarUrl);
    setNotificationsEnabled(user.notificationEnabled === 1);

    return () => {
      unsubscribeFriends();
      unsubscribeGroups();
      unsubscribePending();
    };
  }, [user]);

  const fetchGroups = async () => {}; // Replaced by onSnapshot
  const fetchFriends = async () => {}; // Replaced by onSnapshot
  const fetchPendingRequests = async () => {}; // Replaced by onSnapshot

  // Request notification permission
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  // Listen for active chat messages
  useEffect(() => {
    if (!selectedChat || !user) {
      setMessages([]);
      return;
    }

    let msgQuery;
    if (selectedChat.type === 'group') {
      msgQuery = query(
        collection(db, 'chats', selectedChat.id, 'messages'),
        orderBy('createdAt', 'asc')
      );
    } else {
      // DM path format: minId_maxId
      const ids = [user.id, selectedChat.id].sort();
      const dmPath = ids.join('_');
      msgQuery = query(
        collection(db, 'direct_messages', dmPath, 'messages'),
        orderBy('createdAt', 'asc')
      );
    }

    const unsubscribe = onSnapshot(msgQuery, (snapshot) => {
      const msgs = snapshot.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          createdAt: data.createdAt?.toDate?.()?.toISOString() || new Date().toISOString()
        } as ChatMessage;
      });
      setMessages(msgs);
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'messages'));

    return () => unsubscribe();
  }, [selectedChat, user]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSearch = async () => {
    if (!searchId || !user) return;
    try {
      // Search by username (case-insensitive search is tricky in Firestore, 
      // but we'll assume exact match for now as requested "same usernames")
      const q = query(collection(db, 'users'), where('username', '==', searchId));
      const snapshot = await getDocs(q);
      
      const results: UserProfile[] = [];
      for (const docSnapshot of snapshot.docs) {
        const foundUser = docSnapshot.data() as UserProfile;
        
        // Check relationship for each result
        const relDoc = await getDoc(doc(db, 'users', user.id, 'friends', foundUser.id));
        const relation = relDoc.exists() ? relDoc.data().status : null;
        
        results.push({ ...foundUser, relation });
      }
      
      setSearchResults(results);
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, 'users');
      setSearchResults([]);
    }
  };

  const sendFriendRequest = async (friendId: string) => {
    if (!user || friendRequestLoading) return;
    setFriendRequestLoading(friendId);
    try {
      // 1. Add to my friends as pending (outbound)
      await setDoc(doc(db, 'users', user.id, 'friends', friendId), {
        userId: user.id,
        friendId: friendId,
        status: 'pending',
        updatedAt: serverTimestamp()
      });
      
      // 2. Add to their friends as pending (inbound)
      await setDoc(doc(db, 'users', friendId, 'friends', user.id), {
        userId: friendId,
        friendId: user.id,
        status: 'pending',
        updatedAt: serverTimestamp()
      });

      setToast({ message: "Friend request sent successfully!", type: 'success' });
      
      // Update the specific user in results
      setSearchResults(prev => prev.map(res => 
        res.id === friendId ? { ...res, relation: 'pending' } : res
      ));
    } catch (err: any) {
      handleFirestoreError(err, OperationType.WRITE, 'friends');
    } finally {
      setFriendRequestLoading(null);
    }
  };

  const respondToRequest = async (friendId: string, action: 'accept' | 'decline') => {
    if (!user) return;
    try {
      if (action === 'accept') {
        // Update both sides to 'accepted'
        await updateDoc(doc(db, 'users', user.id, 'friends', friendId), {
          status: 'accepted',
          updatedAt: serverTimestamp()
        });
        await updateDoc(doc(db, 'users', friendId, 'friends', user.id), {
          status: 'accepted',
          updatedAt: serverTimestamp()
        });
        setToast({ message: "Friend request accepted!", type: 'success' });
      } else {
        // Delete both records
        await deleteDoc(doc(db, 'users', user.id, 'friends', friendId));
        await deleteDoc(doc(db, 'users', friendId, 'friends', user.id));
      }
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, 'friends');
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim() || !selectedChat || !user) return;

    const content = inputMessage.trim();
    setInputMessage('');

    try {
      const msgData = {
        senderId: user.id,
        senderName: user.username,
        senderAvatar: user.avatarUrl,
        content,
        createdAt: serverTimestamp(),
        readReceipt: 0,
        isForwarded: false
      };

      if (selectedChat.type === 'group') {
        await addDoc(collection(db, 'chats', selectedChat.id, 'messages'), {
          ...msgData,
          chatId: selectedChat.id
        });
      } else {
        const ids = [user.id, selectedChat.id].sort();
        const dmPath = ids.join('_');
        await addDoc(collection(db, 'direct_messages', dmPath, 'messages'), {
          ...msgData,
          receiverId: selectedChat.id
        });
      }
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, 'messages');
    }
  };

  const deleteMessage = async (messageId: string) => {
    if (!selectedChat || !user) return;
    try {
      if (selectedChat.type === 'group') {
        await deleteDoc(doc(db, 'chats', selectedChat.id, 'messages', messageId));
      } else {
        const ids = [user.id, selectedChat.id].sort();
        const dmPath = ids.join('_');
        await deleteDoc(doc(db, 'direct_messages', dmPath, 'messages', messageId));
      }
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, 'messages');
    }
  };

  const forwardMessageToTarget = async (target: ChatTarget) => {
    if (!forwardingMessage || !user) return;
    
    try {
      const msgData = {
        senderId: user.id,
        senderName: user.username,
        senderAvatar: user.avatarUrl,
        content: forwardingMessage.content,
        createdAt: serverTimestamp(),
        readReceipt: 0,
        isForwarded: true
      };

      if (target.type === 'group') {
        await addDoc(collection(db, 'chats', target.id, 'messages'), {
          ...msgData,
          chatId: target.id
        });
      } else {
        const ids = [user.id, target.id].sort();
        const dmPath = ids.join('_');
        await addDoc(collection(db, 'direct_messages', dmPath, 'messages'), {
          ...msgData,
          receiverId: target.id
        });
      }
      
      setToast({ message: "Message forwarded!", type: 'success' });
      setForwardingMessage(null);
      setShowForwardModal(false);
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, 'forward');
    }
  };

  const toggleGroupMember = (uid: string) => {
    setSelectedGroupMembers(prev => 
      prev.includes(uid) ? prev.filter(id => id !== uid) : [...prev, uid]
    );
  };



  const createGroup = async () => {
    if (!groupName || selectedGroupMembers.length === 0 || !user) return;
    try {
      const memberIds = [...selectedGroupMembers, user.id];
      const newChatRef = doc(collection(db, 'chats'));
      const chatId = newChatRef.id;
      
      const chatData = {
        id: chatId,
        name: groupName,
        type: 'group',
        createdBy: user.id,
        avatarUrl: selectedGroupAvatar,
        memberIds: memberIds,
        createdAt: serverTimestamp()
      };

      await setDoc(newChatRef, chatData);
      
      // Initialize membership subcollection for easier listing/security
      await Promise.all(memberIds.map(uid => 
        setDoc(doc(db, 'chats', chatId, 'members', uid), {
          userId: uid,
          joinedAt: serverTimestamp()
        })
      ));

      setShowGroupCreate(false);
      setGroupName('');
      setSelectedGroupMembers([]);
      setToast({ message: "Group created successfully!", type: 'success' });
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, 'chats');
    }
  };

  const updateGroupInfo = async () => {
    if (!selectedChat || selectedChat.type !== 'group' || !user) return;
    try {
      await updateDoc(doc(db, 'chats', selectedChat.id), {
        name: editGroupName,
        avatarUrl: selectedGroupAvatar
      });
      setSelectedChat({ ...selectedChat, name: editGroupName, avatarUrl: selectedGroupAvatar } as Group);
      setShowGroupSettings(false);
      setToast({ message: "Group updated!", type: 'success' });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `chats/${selectedChat.id}`);
    }
  };

  const addMemberToGroup = async (uid: string) => {
    if (!selectedChat || selectedChat.type !== 'group') return;
    try {
      const chatRef = doc(db, 'chats', selectedChat.id);
      const chatDoc = await getDoc(chatRef);
      if (!chatDoc.exists()) return;
      
      const currentMembers = chatDoc.data().memberIds || [];
      if (!currentMembers.includes(uid)) {
        const newMembers = [...currentMembers, uid];
        await updateDoc(chatRef, { memberIds: newMembers });
        await setDoc(doc(db, 'chats', selectedChat.id, 'members', uid), {
          userId: uid,
          joinedAt: serverTimestamp()
        });
        
        // Refresh local members list
        const resMem = await getDocs(collection(db, 'chats', selectedChat.id, 'members'));
        const membersData = await Promise.all(resMem.docs.map(async (d) => {
          const userDoc = await getDoc(doc(db, 'users', d.id));
          return { id: d.id, ...userDoc.data() } as UserProfile;
        }));
        setCurrentGroupMembers(membersData);
      }
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `chats/${selectedChat.id}`);
    }
  };

  const removeMemberFromGroup = async (uid: string) => {
    if (!selectedChat || selectedChat.type !== 'group' || !user) return;
    try {
      const chatRef = doc(db, 'chats', selectedChat.id);
      const chatDoc = await getDoc(chatRef);
      if (!chatDoc.exists()) return;
      
      const currentMembers = chatDoc.data().memberIds || [];
      const newMembers = currentMembers.filter((m: string) => m !== uid);
      
      await updateDoc(chatRef, { memberIds: newMembers });
      await deleteDoc(doc(db, 'chats', selectedChat.id, 'members', uid));

      // Refresh local members list
      const resMem = await getDocs(collection(db, 'chats', selectedChat.id, 'members'));
      const membersData = await Promise.all(resMem.docs.map(async (d) => {
        const userDoc = await getDoc(doc(db, 'users', d.id));
        return { id: d.id, ...userDoc.data() } as UserProfile;
      }));
      setCurrentGroupMembers(membersData);
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `chats/${selectedChat.id}`);
    }
  };

  const updateProfile = async () => {
    setIsSaving(true);
    try {
      if (user) {
        await updateUser({ 
          username: editUsername, 
          avatarUrl: selectedAvatar, 
          notificationEnabled: notificationsEnabled ? 1 : 0 
        });
        setShowSavedMessage(true);
        setTimeout(() => setShowSavedMessage(false), 3000);
      }
    } catch (e) {
      console.error("Failed to update profile", e);
      setToast({ message: "Failed to update profile", type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const toggleBlock = async (friend: UserProfile) => {
    if (!user) return;
    const isBlocked = friend.status === 'blocked';
    const newStatus = isBlocked ? 'accepted' : 'blocked';
    
    try {
      await updateDoc(doc(db, 'users', user.id, 'friends', friend.id), {
        status: newStatus,
        updatedAt: serverTimestamp()
      });
      
      if (selectedChat?.id === friend.id) {
        setSelectedChat({ ...friend, status: newStatus });
      }
      setToast({ message: isBlocked ? "User unblocked" : "User blocked", type: 'info' });
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `users/${user.id}/friends/${friend.id}`);
    }
  };

  const removeFriend = async (friend: UserProfile) => {
    if (!user) return;
    if (!confirm(`Are you sure you want to remove ${friend.username} from your contacts?`)) return;
    try {
      await deleteDoc(doc(db, 'users', user.id, 'friends', friend.id));
      await deleteDoc(doc(db, 'users', friend.id, 'friends', user.id));
      
      setToast({ message: "Connection removed", type: 'info' });
      setSelectedChat(null);
      setMobileView('chats');
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, `users/${user.id}/friends/${friend.id}`);
    }
  };

  const startChat = async (target: ChatTarget) => {
    setSelectedChat(target);
    setMobileView('chat_room');
    setMessages([]);
    setShowGroupSettings(false);
    
    if (target.type === 'group') {
      const g = target as Group;
      setEditGroupName(g.name);
      setSelectedGroupAvatar(g.avatarUrl || AVATAR_OPTIONS[0]);
      
      // Fetch members from Firestore
      try {
        const resMem = await getDocs(collection(db, 'chats', target.id, 'members'));
        const membersData = await Promise.all(resMem.docs.map(async (d) => {
          const userDoc = await getDoc(doc(db, 'users', d.id));
          return { id: d.id, ...userDoc.data() } as UserProfile;
        }));
        setCurrentGroupMembers(membersData);
      } catch (e) {
        handleFirestoreError(e, OperationType.LIST, `chats/${target.id}/members`);
      }
    }
  };

  const UserAvatar = ({ src, name, size = "w-10 h-10", status }: { src?: string | null, name: string, size?: string, status?: number }) => (
    <div className={cn("relative shrink-0", size)}>
      {src ? (
        <img src={src} alt={name} className={cn("rounded-full bg-slate-100 object-cover border border-slate-200", size)} referrerPolicy="no-referrer" />
      ) : (
        <div className={cn("rounded-full flex items-center justify-center font-bold text-sm bg-slate-700 text-slate-200 uppercase", size)}>
          {name[0]}
        </div>
      )}
      {status === 1 && (
        <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-400 border-2 border-white rounded-full" />
      )}
    </div>
  );

  return (
    <div className="flex flex-col md:flex-row h-screen h-[100dvh] bg-slate-100 overflow-hidden font-sans text-slate-800">
      
      {/* 1. Sidebar Panel (History / Chats) */}
      <div className={cn(
        "w-full md:w-72 bg-slate-900 flex flex-col h-full shrink-0 border-r border-slate-800 transition-all",
        mobileView === 'chats' ? "flex" : "hidden md:flex"
      )}>
        <div className="p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center">
              <MessageCircle className="text-white w-4 h-4" />
            </div>
            <span className="text-white font-bold text-xl tracking-tight uppercase">CONNEXA</span>
          </div>
          <button type="button" onClick={() => setMobileView('profile')} className="md:hidden p-2 text-slate-400">
            <User className="w-6 h-6" />
          </button>
        </div>

        <div className="mt-4 px-4 flex-1 overflow-y-auto">
          <div className="flex items-center justify-between px-2 mb-4">
            <h3 className="text-slate-500 text-[11px] font-bold uppercase tracking-widest flex items-center gap-2">
              Connections
              {pendingRequests.length > 0 && (
                <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              )}
            </h3>
            <button type="button" onClick={() => setShowGroupCreate(true)} className="text-indigo-400 hover:text-indigo-300">
              <Users className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-1">
            {groups.map((group) => (
              <div
                key={`group-${group.id}`}
                onClick={() => startChat(group)}
                className={cn(
                  "flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all",
                  selectedChat?.id === group.id 
                    ? "bg-indigo-600 text-white shadow-lg shadow-indigo-900/20" 
                    : "text-slate-400 hover:bg-slate-800"
                )}
              >
                <UserAvatar src={group.avatarUrl} name={group.name} />
                <div className="flex-1 overflow-hidden text-left">
                  <p className={cn("text-sm font-semibold truncate", selectedChat?.id === group.id ? "text-white" : "text-slate-200")}>
                    {group.name}
                  </p>
                  <p className="text-xs truncate opacity-70">Group Chat</p>
                </div>
              </div>
            ))}
            {chats.map((chat) => (
              <div
                key={`chat-${chat.id}`}
                onClick={() => startChat(chat)}
                className={cn(
                  "flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all",
                  selectedChat?.id === chat.id 
                    ? "bg-indigo-600 text-white shadow-lg shadow-indigo-900/20" 
                    : "text-slate-400 hover:bg-slate-800"
                )}
              >
                <UserAvatar src={chat.avatarUrl} name={chat.username} status={chat.online_status} />
                <div className="flex-1 overflow-hidden text-left">
                  <p className={cn("text-sm font-semibold truncate", selectedChat?.id === chat.id ? "text-white" : "text-slate-200")}>
                    {chat.username}
                  </p>
                  <p className="text-xs truncate opacity-70">
                    {chat.status === 'blocked' ? 'Blocked' : (chat.online_status === 1 ? 'Online' : 'Offline')}
                  </p>
                </div>
              </div>
            ))}
            {chats.length === 0 && (
              <div className="px-2 py-8 text-center">
                <p className="text-[10px] text-slate-600 leading-normal">You don't have any connections yet. Search a Unique ID to add friends.</p>
              </div>
            )}
          </div>
        </div>

        <div className="p-4 border-t border-slate-800 hidden md:block">
          <button 
            type="button"
            onClick={() => setMobileView('settings')}
            className="w-full flex items-center gap-3 p-3 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-all"
          >
            <Settings className="w-4 h-4" />
            <span className="text-xs font-bold uppercase tracking-widest">Settings</span>
          </button>
        </div>
      </div>

      {/* 2. Main Chat Panel */}
      <div className={cn(
        "flex-1 flex flex-col bg-white relative overflow-hidden min-h-0",
        mobileView === 'chat_room' ? "flex" : "hidden md:flex"
      )}>
        <AnimatePresence mode="wait">
          {selectedChat ? (
            <motion.div key={selectedChat.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 flex flex-col min-h-0">
              {/* Chat Header */}
              <div className="h-16 border-b border-slate-200 flex items-center justify-between px-4 md:px-6 shrink-0 bg-white z-10">
                <div className="flex items-center gap-3">
        <div className="md:hidden p-2 -ml-2 text-slate-400 flex items-center justify-center relative">
          <button type="button" onClick={() => { setSelectedChat(null); setMobileView('chats'); }} className="p-2">
            <X className="w-5 h-5" />
          </button>
          {pendingRequests.length > 0 && (
            <div className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full border border-white" />
          )}
        </div>
                  {selectedChat.type === 'group' ? (
                    <UserAvatar src={(selectedChat as Group).avatarUrl} name={(selectedChat as Group).name} size="w-8 h-8" />
                  ) : (
                    <UserAvatar src={(selectedChat as UserProfile).avatarUrl} name={(selectedChat as UserProfile).username} status={(selectedChat as UserProfile).online_status} size="w-8 h-8" />
                  )}
                  <div className="flex flex-col">
                    <h2 className="font-bold text-slate-800 text-sm leading-tight flex items-center gap-2">
                      {selectedChat.type === 'group' ? (selectedChat as Group).name : (selectedChat as UserProfile).username}
                      {selectedChat.type === 'group' && (
                        <button type="button" onClick={() => setShowGroupSettings(true)} className="p-1 hover:bg-slate-100 rounded-full text-indigo-500 transition-all" title="Group Info">
                          <Settings className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </h2>
                    <p className={cn("text-[10px] font-medium tracking-wide uppercase", selectedChat.type !== 'group' && (selectedChat as UserProfile).status === 'blocked' ? 'text-red-500' : (selectedChat.type !== 'group' && (selectedChat as UserProfile).online_status === 1 ? "text-green-500" : "text-slate-400"))}>
                      {selectedChat.type === 'group' ? `${currentGroupMembers.length} Members` : `${(selectedChat as UserProfile).status === 'blocked' ? 'Blocked' : ((selectedChat as UserProfile).online_status === 1 ? 'Online' : 'Offline')} • ${(selectedChat as UserProfile).connexaId}`}
                    </p>
                  </div>
                </div>
                {selectedChat.type !== 'group' && (
                  <div className="flex items-center gap-2">
                    <button 
                      type="button"
                      onClick={() => toggleBlock(selectedChat as UserProfile)}
                      className={cn(
                        "p-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all",
                        (selectedChat as UserProfile).status === 'blocked' 
                          ? "bg-slate-100 text-slate-900 border border-slate-200 hover:bg-slate-200" 
                          : "bg-red-50 text-red-600 border border-red-100 hover:bg-red-100"
                      )}
                    >
                      {(selectedChat as UserProfile).status === 'blocked' ? 'Unblock' : 'Block'}
                    </button>
                    <button 
                      type="button"
                      onClick={() => removeFriend(selectedChat as UserProfile)}
                      className="p-2 rounded-lg text-[10px] font-bold uppercase tracking-widest bg-slate-100 text-slate-500 border border-slate-200 hover:bg-red-50 hover:text-red-500 hover:border-red-100 transition-all"
                      title="Remove Connection"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>

              {/* Messages Area */}
              <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6 bg-slate-50/10 min-h-0">
                {messages.map((msg) => (
                  <div key={`msg-${msg.id}`} className={cn("group flex gap-3 max-w-[85%] md:max-w-[75%]", msg.senderId === user?.id ? "flex-row-reverse ml-auto" : "flex-row mr-auto")}>
                    {msg.senderId !== user?.id && (
                      <UserAvatar 
                        src={msg.senderAvatar || (selectedChat.type === 'group' ? currentGroupMembers.find(m => m.id === msg.senderId)?.avatarUrl : (selectedChat as UserProfile).avatarUrl)} 
                        name={msg.senderName || (selectedChat.type === 'group' ? 'Member' : (selectedChat as UserProfile).username)} 
                        size="w-8 h-8" 
                      />
                    )}
                    <div className={cn("flex flex-col gap-1 relative", msg.senderId === user?.id ? "items-end" : "items-start")}>
                      {selectedChat.type === 'group' && msg.senderId !== user?.id && (
                        <span className="text-[9px] font-bold text-slate-400 uppercase ml-1">{msg.senderName}</span>
                      )}
                      <div className={cn("p-3 rounded-2xl text-sm shadow-sm relative", msg.senderId === user?.id ? "bg-indigo-600 text-white rounded-br-none shadow-indigo-100" : "bg-white text-slate-700 rounded-bl-none border border-slate-200")}>
                        {msg.isForwarded && (
                          <div className="flex items-center gap-1 mb-1 text-[9px] font-bold uppercase tracking-widest opacity-60">
                            <Send className="w-2.5 h-2.5 rotate-[-45deg]" /> Forwarded
                          </div>
                        )}
                        {msg.content}
                        <div className={cn(
                          "absolute top-0 flex gap-1 transition-all opacity-0 group-hover:opacity-100",
                          msg.senderId === user?.id ? "-left-20" : "-right-20"
                        )}>
                          <button 
                            type="button"
                            onClick={() => {
                              setForwardingMessage(msg);
                              setShowForwardModal(true);
                            }}
                            className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-white rounded-lg border border-transparent hover:border-slate-100 shadow-sm transition-all"
                            title="Forward"
                          >
                            <Send className="w-4 h-4 rotate-[-45deg]" />
                          </button>
                          {msg.senderId === user?.id && (
                            <button 
                              type="button"
                              onClick={() => deleteMessage(msg.id)}
                              className="p-2 text-slate-400 hover:text-red-500 hover:bg-white rounded-lg border border-transparent hover:border-slate-100 shadow-sm transition-all"
                              title="Delete"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 px-1 mt-0.5">
                        <span className="text-[10px] text-slate-400 font-medium tracking-tight">
                          {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {msg.senderId === user?.id && selectedChat.type !== 'group' && (
                          <div className="flex items-center h-3">
                            {msg.readReceipt === 1 ? (
                              <CheckCheck className="w-3.5 h-3.5 text-blue-500" />
                            ) : (
                              <Check className="w-3.5 h-3.5 text-slate-300" />
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Chat Input */}
              <div className="p-4 md:p-6 border-t border-slate-100 bg-white flex-none relative z-30 shadow-[0_-8px_30px_rgb(0,0,0,0.04)] pb-safe">
                {selectedChat.type !== 'group' && (selectedChat as UserProfile).status === 'blocked' ? (
                  <div className="w-full flex items-center justify-center bg-slate-50 py-3 rounded-xl border border-slate-100">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">You have blocked this user</p>
                  </div>
                ) : (
                  <form onSubmit={handleSendMessage} className="w-full flex gap-2 md:gap-3 items-center">
                    <div className="flex-1 bg-slate-100 rounded-xl px-4 py-3 flex items-center focus-within:ring-2 focus-within:ring-indigo-500 transition-all border border-transparent focus-within:border-indigo-100">
                      <input
                        type="text"
                        value={inputMessage}
                        onChange={(e) => setInputMessage(e.target.value)}
                        placeholder="Type a message..."
                        className="w-full bg-transparent border-none outline-none text-sm placeholder:text-slate-400 text-slate-800"
                      />
                    </div>
                    <button 
                      type="submit" 
                      disabled={!inputMessage.trim()} 
                      className="w-11 h-11 md:w-12 md:h-12 bg-indigo-600 text-white rounded-xl flex items-center justify-center shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all active:scale-95 disabled:opacity-40 shrink-0"
                    >
                      <Send className="w-5 h-5" />
                    </button>
                  </form>
                )}
              </div>
            </motion.div>
          ) : (
            <div key="empty-chat-state" className="flex-1 flex items-center justify-center bg-slate-50/50 p-6">
              <div className="text-center">
                <div className="w-20 h-20 bg-white shadow-xl shadow-slate-200 border border-slate-100 rounded-[2rem] flex items-center justify-center mx-auto mb-8">
                  <MessageCircle className="w-10 h-10 text-indigo-500/20" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-2 text-center">Hello, {user?.username}</h3>
                <p className="text-slate-400 max-w-xs mx-auto text-sm leading-relaxed text-center">Select a contact or add a new friend to start chatting securely.</p>
              </div>
            </div>
          )}

          {/* Forward Message Modal */}
          <AnimatePresence key="forward-modal-presence">
            {showForwardModal && (
              <motion.div 
                key="forward-modal-overlay"
                initial={{ opacity: 0 }} 
                animate={{ opacity: 1 }} 
                exit={{ opacity: 0 }} 
                className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
              >
                <motion.div 
                  key="forward-modal-content"
                  initial={{ scale: 0.95, opacity: 0, y: 20 }}
                  animate={{ scale: 1, opacity: 1, y: 0 }}
                  exit={{ scale: 0.95, opacity: 0, y: 20 }}
                  className="bg-white rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl flex flex-col max-h-[80vh]"
                >
                  <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                    <div>
                      <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Select recipient</h3>
                      <h2 className="font-bold text-slate-900">Forward Message</h2>
                    </div>
                    <button 
                      type="button"
                      onClick={() => {
                        setShowForwardModal(false);
                        setForwardingMessage(null);
                      }}
                      className="p-2 text-slate-400 hover:bg-slate-50 rounded-xl transition-all"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto p-4 space-y-2">
                    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-2 mb-2">Direct Messages</h4>
                    {chats.map(chat => (
                      <button 
                        type="button"
                        key={`forward-chat-${chat.id}`}
                        onClick={() => forwardMessageToTarget(chat)}
                        className="w-full flex items-center gap-3 p-3 rounded-2xl hover:bg-slate-50 transition-all text-left"
                      >
                        <UserAvatar src={chat.avatarUrl} name={chat.username} size="w-10 h-10" />
                        <span className="text-xs font-bold text-slate-700">{chat.username}</span>
                      </button>
                    ))}

                    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-2 mb-2 mt-6">Groups</h4>
                    {groups.map(group => (
                      <button 
                        type="button"
                        key={`forward-group-${group.id}`}
                        onClick={() => forwardMessageToTarget(group)}
                        className="w-full flex items-center gap-3 p-3 rounded-2xl hover:bg-slate-50 transition-all text-left"
                      >
                        <UserAvatar src={group.avatarUrl} name={group.name} size="w-10 h-10" />
                        <span className="text-xs font-bold text-slate-700">{group.name}</span>
                      </button>
                    ))}
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </AnimatePresence>
      </div>

      {/* 3. Right Sidebar (Profile, Settings, Interaction) */}
      <div className={cn(
        "w-full md:w-80 bg-slate-50 border-l border-slate-200 flex flex-col h-[100dvh] md:h-screen shrink-0 overflow-hidden transition-all",
        (mobileView === 'profile' || mobileView === 'settings') ? "flex" : "hidden md:flex"
      )}>
        {mobileView === 'settings' ? (
          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="flex flex-col h-full overflow-hidden">
            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-8">
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setMobileView('profile')} className="p-2 -ml-2 text-slate-400 hover:text-indigo-600">
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <h2 className="font-bold text-slate-900 text-lg">Edit Profile</h2>
              </div>

              {/* Avatar Selection */}
              <div>
                <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">Identity</h3>
                <div className="flex flex-col items-center gap-4 mb-6">
                  <UserAvatar src={selectedAvatar} name={editUsername} size="w-24 h-24" />
                  <div className="flex flex-col items-center gap-2">
                    <input 
                      type="file" 
                      ref={fileInputRef} 
                      onChange={handleFileUpload} 
                      accept="image/*" 
                      className="hidden" 
                    />
                    <button 
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="text-xs font-bold text-indigo-600 bg-indigo-50 px-4 py-2 rounded-lg hover:bg-indigo-100 transition-all border border-indigo-100"
                    >
                      Upload Custom Photo
                    </button>
                    <p className="text-[9px] text-slate-400 font-medium italic">Or choose a generated avatar below</p>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-3">
                  {AVATAR_OPTIONS.map(url => (
                    <button 
                      type="button"
                      key={`avatar-profile-${url}`} 
                      onClick={() => setSelectedAvatar(url)}
                      className={cn(
                        "w-12 h-12 rounded-full border-2 transition-all p-0.5",
                        selectedAvatar === url ? "border-indigo-600 scale-110 shadow-lg" : "border-transparent opacity-60 hover:opacity-100"
                      )}
                    >
                      <img src={url} alt="avatar" className="w-full h-full rounded-full" />
                    </button>
                  ))}
                </div>
              </div>

              {/* Display Name */}
              <div>
                <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">Display Name</h3>
                <input
                  type="text"
                  value={editUsername}
                  onChange={(e) => setEditUsername(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold focus:ring-2 focus:ring-indigo-500 outline-none shadow-sm"
                />
              </div>

              {/* Notifications */}
              <div className="pb-8">
                <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">Notifications</h3>
                <div className="flex items-center justify-between p-4 bg-white border border-slate-200 rounded-xl shadow-sm">
                  <span className="text-xs font-bold">Push Notifications</span>
                  <button 
                    type="button"
                    onClick={() => setNotificationsEnabled(!notificationsEnabled)}
                    className={cn(
                      "w-10 h-5 rounded-full transition-all relative",
                      notificationsEnabled ? "bg-indigo-600" : "bg-slate-200"
                    )}
                  >
                    <div className={cn(
                      "absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all shadow-sm",
                      notificationsEnabled ? "left-5.5" : "left-0.5"
                    )} />
                  </button>
                </div>
              </div>
            </div>

            {/* Fixed Footer for Button */}
            <div className="p-6 bg-white border-t border-slate-200 shadow-[0_-8px_30px_rgba(0,0,0,0.04)] shrink-0 z-[60] pb-safe mb-16 md:mb-0">
              <button 
                type="button"
                onClick={updateProfile}
                disabled={isSaving}
                className={cn(
                  "w-full font-bold py-4 rounded-xl flex items-center justify-center gap-2 shadow-lg active:scale-95 transition-all text-sm",
                  showSavedMessage 
                    ? "bg-green-500 text-white shadow-green-100" 
                    : "bg-indigo-600 text-white shadow-indigo-100 hover:bg-indigo-700",
                  isSaving && "opacity-70 cursor-not-allowed"
                )}
              >
                {isSaving ? (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Saving...
                  </div>
                ) : showSavedMessage ? (
                  <>
                    <Check className="w-4 h-4" /> Changes Saved!
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" /> Save Changes
                  </>
                )}
              </button>
            </div>
          </motion.div>
        ) : (
          <div className="p-6 flex flex-col h-full overflow-y-auto">
            <div className="flex items-center justify-between mb-8 md:hidden shrink-0">
              <h2 className="font-bold text-slate-900">Connexa Identity</h2>
              <button type="button" onClick={() => setMobileView('chats')} className="p-2 bg-white rounded-lg border border-slate-200 transition-colors active:bg-slate-100">
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            {/* Profile Card */}
            <div className="p-5 bg-white border border-slate-200 rounded-2xl flex flex-col items-center text-center mb-8 shadow-sm shrink-0 relative overflow-hidden group">
              <div className="absolute top-0 left-0 w-full h-1 bg-indigo-600"></div>
              <UserAvatar src={user?.avatarUrl} name={user?.username || ''} size="w-20 h-20" />
              <div className="mt-4">
                <h3 className="text-slate-900 text-lg font-bold">{user?.username}</h3>
                <p className="text-indigo-600 text-[11px] font-mono font-bold tracking-widest uppercase">{user?.connexaId}</p>
              </div>
              <div className="flex gap-4 mt-6 w-full">
                <button type="button" onClick={() => setMobileView('settings')} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-all border border-indigo-100">
                  <Settings className="w-4 h-4" />
                  <span className="text-xs font-bold uppercase tracking-widest">Edit Profile</span>
                </button>
                <button type="button" onClick={logout} className="flex-1 flex flex-col items-center gap-1.5 p-2 rounded-xl hover:bg-red-50 transition-colors border border-transparent hover:border-red-100">
                  <div className="w-8 h-8 rounded-lg bg-red-50/50 flex items-center justify-center text-red-400">
                    <LogOut className="w-4 h-4" />
                  </div>
                  <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500">Logout</span>
                </button>
              </div>
            </div>

            {/* Search by Username */}
            <div className="mb-8 shrink-0">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-[10px] font-bold text-slate-900 uppercase tracking-widest">Find Connections</h3>
                {searchResults.length > 0 && (
                  <span className="text-[10px] font-bold px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded-full border border-indigo-100">
                    {searchResults.length} {searchResults.length === 1 ? 'match' : 'matches'}
                  </span>
                )}
              </div>
              <div className="relative">
                <input
                  type="text"
                  placeholder="Enter username..."
                  value={searchId}
                  onChange={(e) => setSearchId(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  className="w-full bg-white border border-slate-200 rounded-xl pl-4 pr-10 py-3 text-xs font-bold focus:ring-2 focus:ring-indigo-500 outline-none shadow-sm transition-all"
                />
                <button type="button" onClick={handleSearch} className="absolute right-2 top-2 p-1.5 text-indigo-600 hover:bg-slate-50 rounded-lg transition-all">
                  <Search className="w-4 h-4" />
                </button>
              </div>
              
              {searchResults.length > 0 && (
                <div className="mt-3 space-y-3 max-h-[300px] overflow-y-auto p-1 scrollbar-hide">
                  <AnimatePresence mode="popLayout">
                    {searchResults.map((result) => (
                      <motion.div 
                        key={`search-res-${result.id}`}
                        initial={{ opacity: 0, x: -10 }} 
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="p-4 bg-white border border-indigo-100 rounded-xl shadow-lg ring-4 ring-indigo-50/50"
                      >
                        <div className="flex items-center gap-3 mb-3">
                          <UserAvatar src={result.avatarUrl} name={result.username} size="w-10 h-10" />
                          <div className="flex-1 overflow-hidden">
                            <p className="text-xs font-bold text-slate-900 truncate">{result.username}</p>
                            <p className="text-[10px] font-mono text-indigo-500 font-bold">{result.connexaId}</p>
                          </div>
                        </div>
                        {result.id === user?.id ? (
                          <div className="w-full py-2.5 bg-slate-100 text-slate-500 rounded-xl text-[10px] font-bold uppercase tracking-widest text-center">
                            This is you
                          </div>
                        ) : result.relation === 'accepted' || chats.some(f => f.id === result.id) ? (
                          <div className="w-full py-2.5 bg-green-50 text-green-600 rounded-xl text-[10px] font-bold uppercase tracking-widest text-center border border-green-100 flex items-center justify-center gap-2">
                            <Check className="w-3 h-3" /> Already Friends
                          </div>
                        ) : result.relation === 'pending' ? (
                          <div className="w-full py-2.5 bg-amber-50 text-amber-600 rounded-xl text-[10px] font-bold uppercase tracking-widest text-center border border-amber-100 flex items-center justify-center gap-2">
                            <motion.div animate={{ opacity: [1, 0.5, 1] }} transition={{ repeat: Infinity, duration: 2 }}>
                              <Check className="w-3 h-3" />
                            </motion.div>
                            Request Pending
                          </div>
                        ) : (
                          <button 
                            type="button" 
                            disabled={friendRequestLoading === result.id}
                            onClick={() => sendFriendRequest(result.id)} 
                            className={cn(
                              "w-full py-3 bg-indigo-600 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-lg active:scale-[0.98] flex items-center justify-center gap-2",
                              friendRequestLoading === result.id && "opacity-70 cursor-not-allowed"
                            )}
                          >
                            {friendRequestLoading === result.id ? (
                              <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }} className="w-3 h-3 border-2 border-white border-t-transparent rounded-full" />
                            ) : (
                              <UserPlus className="w-3 h-3" />
                            )}
                            Add Friend
                          </button>
                        )}
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              )}
              {searchId && searchResults.length === 0 && (
                <div className="mt-4 text-center py-6 border border-dashed border-slate-200 rounded-xl">
                   <p className="text-[10px] text-slate-400 italic font-medium">No results for "{searchId}"</p>
                </div>
              )}
            </div>

            {/* Pending Requests */}
            <div className="flex-1 min-h-[150px]">
              <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                Invites <span className="bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded-md text-[9px]">{pendingRequests.length}</span>
              </h3>
              <div className="space-y-3">
                {pendingRequests.map(req => (
                  <div key={`pending-${req.id}`} className="p-3 bg-white border border-slate-200 rounded-xl flex items-center gap-3 shadow-sm">
                    <UserAvatar src={req.avatarUrl} name={req.username} size="w-10 h-10" />
                    <div className="flex-1 overflow-hidden text-left">
                      <p className="text-xs font-bold truncate text-slate-800">{req.username}</p>
                      <div className="flex gap-2 mt-1">
                        <button type="button" onClick={() => respondToRequest(req.id, 'accept')} className="text-[9px] font-bold text-indigo-600 hover:underline">Accept</button>
                        <button type="button" onClick={() => respondToRequest(req.id, 'decline')} className="text-[9px] font-bold text-slate-400 hover:underline">Ignore</button>
                      </div>
                    </div>
                  </div>
                ))}
                {pendingRequests.length === 0 && (
                  <div className="text-center py-6 border border-dashed border-slate-200 rounded-2xl">
                    <p className="text-[10px] text-slate-300 italic">No incoming invitations</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Mobile Sticky Navbar */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-white border-t border-slate-200 flex items-center justify-around px-4 z-20 shadow-2xl">
        <button type="button" onClick={() => setMobileView('chats')} className={cn("flex flex-col items-center gap-1", mobileView === 'chats' ? "text-indigo-600" : "text-slate-300")}>
          <MessageCircle className="w-6 h-6" />
          <span className="text-[9px] font-bold uppercase">Chats</span>
        </button>
        <button type="button" onClick={() => setMobileView('profile')} className={cn("flex flex-col items-center gap-1 relative", (mobileView === 'profile' || mobileView === 'settings') ? "text-indigo-600" : "text-slate-300")}>
          <User className="w-6 h-6" />
          {pendingRequests.length > 0 && (
            <div className="absolute top-0 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white" />
          )}
          <span className="text-[9px] font-bold uppercase">Me</span>
        </button>
      </div>

      {/* 4. Group Create Overlay */}
      <AnimatePresence key="group-create-presence">
        {showGroupCreate && (
          <motion.div key="group-create-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div key="group-create-modal" initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} className="bg-white rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl">
              <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                <h2 className="font-bold text-slate-900 capitalize">Create Group</h2>
                <button type="button" onClick={() => setShowGroupCreate(false)} className="text-slate-400 p-1 hover:text-slate-600"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-6 space-y-6">
                <div>
                  <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Group Avatar</h3>
                  <div className="flex flex-col items-center gap-4 mb-4">
                    <UserAvatar src={selectedGroupAvatar} name={groupName || "New Group"} size="w-16 h-16" />
                    <input 
                      type="file" 
                      ref={groupFileInputRef} 
                      onChange={handleGroupFileUpload} 
                      accept="image/*" 
                      className="hidden" 
                    />
                    <button 
                      type="button"
                      onClick={() => groupFileInputRef.current?.click()}
                      className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-lg border border-indigo-100"
                    >
                      Upload Group Photo
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {AVATAR_OPTIONS.map((url) => (
                      <button 
                        type="button"
                        key={`avatar-group-create-${url}`} 
                        onClick={() => setSelectedGroupAvatar(url)}
                        className={cn(
                          "w-10 h-10 rounded-full border-2 transition-all p-0.5",
                          selectedGroupAvatar === url ? "border-indigo-600 scale-105" : "border-transparent opacity-60 hover:opacity-100"
                        )}
                      >
                        <img src={url} alt="Group Avatar" className="w-full h-full rounded-full object-cover" referrerPolicy="no-referrer" />
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Group Name</h3>
                  <input
                    type="text"
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                    placeholder="E.g. Team Connexa"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-600"
                  />
                </div>
                <div>
                  <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Select Members</h3>
                  <div className="max-h-40 overflow-y-auto space-y-2">
                    {chats.map(friend => (
                      <div 
                        key={`create-group-member-${friend.id}`} 
                        onClick={() => toggleGroupMember(friend.id)}
                        className={cn(
                          "flex items-center justify-between p-3 rounded-xl cursor-pointer transition-all border",
                          selectedGroupMembers.includes(friend.id) ? "bg-indigo-50 border-indigo-200" : "bg-white border-slate-100 hover:bg-slate-50"
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <UserAvatar src={friend.avatarUrl} name={friend.username} size="w-8 h-8" />
                          <span className="text-xs font-bold">{friend.username}</span>
                        </div>
                        {selectedGroupMembers.includes(friend.id) && <Check className="w-4 h-4 text-indigo-600" />}
                      </div>
                    ))}
                  </div>
                </div>
                <button 
                  type="button"
                  onClick={async () => {
                    if (!groupName || selectedGroupMembers.length === 0) return;
                    try {
                      const res = await fetch('/api/chats/group', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                          name: groupName, 
                          creatorId: user?.id, 
                          memberIds: [...selectedGroupMembers, user?.id],
                          avatarUrl: selectedGroupAvatar
                        }),
                      });
                      if (res.ok) {
                        fetchGroups();
                        setShowGroupCreate(false);
                        setGroupName('');
                        setSelectedGroupMembers([]);
                      }
                    } catch (e) {}
                  }}
                  disabled={!groupName || selectedGroupMembers.length === 0}
                  className="w-full bg-indigo-600 text-white font-bold py-4 rounded-2xl shadow-lg shadow-indigo-100 active:scale-95 transition-all disabled:opacity-50"
                >
                  Confirm Group
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 5. Group Settings Overlay */}
      <AnimatePresence key="group-settings-presence">
        {showGroupSettings && selectedChat?.type === 'group' && (
          <motion.div key="group-settings-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div key="group-settings-modal" initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl max-h-[85vh] flex flex-col">
              <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                <h2 className="font-bold text-slate-900">{user?.id === (selectedChat as Group).createdBy ? 'Group Settings' : 'Group Info'}</h2>
                <button type="button" onClick={() => setShowGroupSettings(false)} className="text-slate-400 p-1 hover:text-slate-600"><X className="w-5 h-5" /></button>
              </div>
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {user?.id === (selectedChat as Group).createdBy ? (
                  <>
                    <div>
                      <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Update Identity</h3>
                      <div className="flex flex-col items-center gap-4 mb-4">
                        <UserAvatar src={selectedGroupAvatar} name={editGroupName} size="w-16 h-16" />
                        <input 
                          type="file" 
                          ref={groupFileInputRef} 
                          onChange={handleGroupFileUpload} 
                          accept="image/*" 
                          className="hidden" 
                        />
                        <button 
                          type="button"
                          onClick={() => groupFileInputRef.current?.click()}
                          className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-lg border border-indigo-100"
                        >
                          Change Group Photo
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-2 mb-4">
                        {AVATAR_OPTIONS.map((url) => (
                          <button 
                            type="button"
                            key={`avatar-group-edit-${url}`} 
                            onClick={() => setSelectedGroupAvatar(url)}
                            className={cn(
                              "w-10 h-10 rounded-full border-2 transition-all p-0.5",
                              selectedGroupAvatar === url ? "border-indigo-600 scale-105" : "border-transparent opacity-60 hover:opacity-100"
                            )}
                          >
                            <img src={url} alt="Group Avatar" className="w-full h-full rounded-full object-cover" referrerPolicy="no-referrer" />
                          </button>
                        ))}
                      </div>
                      <input
                        type="text"
                        value={editGroupName}
                        onChange={(e) => setEditGroupName(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-600"
                      />
                      <button type="button" onClick={updateGroupInfo} className="mt-3 w-full bg-indigo-600 text-white font-bold py-3 rounded-xl shadow-md text-xs">Update Group Info</button>
                    </div>
                    <hr className="border-slate-100" />
                  </>
                ) : (
                  <div className="flex flex-col items-center py-4 bg-slate-50 rounded-2xl border border-slate-100">
                    <UserAvatar src={(selectedChat as Group).avatarUrl} name={(selectedChat as Group).name} size="w-20 h-20" />
                    <h3 className="mt-4 text-lg font-bold text-slate-900">{(selectedChat as Group).name}</h3>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Group ID: {selectedChat.id.split('-')[0]}...</p>
                  </div>
                )}

                <div>
                  <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Members ({currentGroupMembers.length})</h3>
                  <div className="space-y-2">
                    {currentGroupMembers.map(member => (
                      <div key={`group-member-${member.id}`} className="flex items-center justify-between p-2 rounded-xl hover:bg-slate-50 transition-all">
                        <div className="flex items-center gap-3">
                          <UserAvatar src={member.avatarUrl} name={member.username} size="w-8 h-8" status={member.online_status} />
                          <div className="flex flex-col">
                            <span className="text-xs font-bold">{member.username}</span>
                            {member.id === (selectedChat as Group).createdBy && <span className="text-[9px] text-indigo-500 font-bold uppercase">Admin</span>}
                          </div>
                        </div>
                        {user?.id === (selectedChat as Group).createdBy && member.id !== user.id && (
                          <button type="button" onClick={() => removeMemberFromGroup(member.id)} className="p-1.5 text-red-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all">
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {user?.id === (selectedChat as Group).createdBy && (
                  <div>
                    <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Add New Members</h3>
                    <div className="space-y-2">
                      {chats.filter(f => !currentGroupMembers.find(m => m.id === f.id)).map(friend => (
                        <div key={`add-group-member-${friend.id}`} onClick={() => addMemberToGroup(friend.id)} className="flex items-center justify-between p-3 rounded-xl border border-slate-100 hover:bg-indigo-50 hover:border-indigo-100 cursor-pointer transition-all group">
                          <div className="flex items-center gap-3">
                            <UserAvatar src={friend.avatarUrl} name={friend.username} size="w-8 h-8" />
                            <span className="text-xs font-bold">{friend.username}</span>
                          </div>
                          <Plus className="w-4 h-4 text-slate-300 group-hover:text-indigo-600" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {toast && (
          <Toast 
            message={toast.message} 
            type={toast.type} 
            onClose={() => setToast(null)} 
          />
        )}
      </AnimatePresence>
    </div>
  );
}