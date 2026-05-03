import React, { createContext, useContext, useState, useEffect } from 'react';
import { auth, db } from '../lib/firebase';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';

interface User {
  id: string;
  email: string;
  username: string;
  connexaId: string;
  avatarUrl?: string | null;
  notificationEnabled?: number;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (token: string, user: User) => void;
  updateUser: (userBody: Partial<User>) => void;
  logout: () => void;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 1. Initial check: Try to load from LocalStorage for instant UI render
    const cachedUser = localStorage.getItem('connexa_user');
    if (cachedUser) {
      setUser(JSON.parse(cachedUser));
      // We don't set loading to false yet, we wait for Firebase to confirm the session
    }

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const idToken = await firebaseUser.getIdToken();
        setToken(idToken);
        
        // Fetch additional user data from Firestore
        const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
        if (userDoc.exists()) {
          const data = userDoc.data();
          const userProfile = {
            id: firebaseUser.uid,
            email: firebaseUser.email || '',
            username: data.username,
            connexaId: data.connexaId,
            avatarUrl: data.avatarUrl,
            notificationEnabled: data.notificationEnabled,
          };
          setUser(userProfile);
          localStorage.setItem('connexa_user', JSON.stringify(userProfile));
        }
      } else {
        setUser(null);
        setToken(null);
        localStorage.removeItem('connexa_user');
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const login = (newToken: string, newUser: User) => {
    setToken(newToken);
    setUser(newUser);
  };

  const updateUser = async (userUpdate: Partial<User>) => {
    if (!user) return;
    const updatedUser = { ...user, ...userUpdate };
    setUser(updatedUser);
    
    // Persist to Firestore
    try {
      await setDoc(doc(db, 'users', user.id), userUpdate, { merge: true });
    } catch (e) {
      console.error("Error updating profile:", e);
    }
  };

  const logout = async () => {
    await signOut(auth);
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, token, login, updateUser, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
};
