import React, { createContext, useContext, useState, useEffect } from 'react';

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
  updateUser: (user: User) => void;
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
    const savedToken = localStorage.getItem('connexa_token');
    const savedUser = localStorage.getItem('connexa_user');
    if (savedToken && savedUser) {
      setToken(savedToken);
      setUser(JSON.parse(savedUser));
    }
    setLoading(false);
  }, []);

  const login = (newToken: string, newUser: User) => {
    setToken(newToken);
    setUser(newUser);
    localStorage.setItem('connexa_token', newToken);
    localStorage.setItem('connexa_user', JSON.stringify(newUser));
  };

  const updateUser = (newUser: User) => {
    setUser(newUser);
    localStorage.setItem('connexa_user', JSON.stringify(newUser));
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('connexa_token');
    localStorage.removeItem('connexa_user');
  };

  return (
    <AuthContext.Provider value={{ user, token, login, updateUser, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
};
