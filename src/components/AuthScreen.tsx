import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Loader2, MessageSquare } from 'lucide-react';
import { auth, db } from '../lib/firebase';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  confirmPasswordReset,
  sendPasswordResetEmail
} from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';

export default function AuthScreen() {
  const [isLogin, setIsLogin] = useState(true);
  const [isForgot, setIsForgot] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const { login } = useAuth();

  // Helper to generate Unique Connexa ID
  function generateConnexaId() {
    return "CX-" + Math.random().toString(36).substring(2, 7).toUpperCase();
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      if (isForgot) {
        await sendPasswordResetEmail(auth, email);
        setSuccess('Password reset link sent to your email.');
      } else if (isLogin) {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const idToken = await userCredential.user.getIdToken();
        // The AuthProvider useEffect will handle state update, 
        // but we can call login if we want to force immediate redirect if needed
      } else {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const connexaId = generateConnexaId();
        
        // Initialize user in Firestore
        const userObj = {
          id: userCredential.user.uid,
          email,
          username,
          connexaId,
          avatarUrl: `https://api.dicebear.com/7.x/shapes/svg?seed=${username}`,
          notificationEnabled: 1,
          onlineStatus: 1,
          lastSeen: new Date().toISOString()
        };

        await setDoc(doc(db, 'users', userCredential.user.uid), userObj);
        
        const idToken = await userCredential.user.getIdToken();
        login(idToken, {
          id: userCredential.user.uid,
          email,
          username,
          connexaId,
          avatarUrl: userObj.avatarUrl,
          notificationEnabled: 1
        });
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4 font-sans text-slate-800">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-200 overflow-hidden">
        <div className="p-8">
          <div className="flex items-center justify-center mb-10 gap-3">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-200">
              <MessageSquare className="text-white w-6 h-6" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">CONNEXA</h1>
          </div>

          <h2 className="text-lg font-bold text-center mb-6 text-slate-800">
            {isForgot ? 'Reset Password' : (isLogin ? 'Sign In' : 'Create Account')}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-5">
            {!isLogin && !isForgot && (
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5 block ml-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all placeholder:text-slate-300"
                  placeholder="John Doe"
                />
              </div>
            )}
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5 block ml-1">Email Address</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all placeholder:text-slate-300"
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5 block ml-1">
                {isForgot ? 'New Password' : 'Password'}
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all placeholder:text-slate-300"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-100 p-3 rounded-xl">
                <p className="text-red-600 text-xs font-semibold">{error}</p>
              </div>
            )}
            {success && (
              <div className="bg-green-50 border border-green-100 p-3 rounded-xl">
                <p className="text-green-600 text-xs font-semibold">{success}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 text-white font-bold py-3.5 rounded-xl hover:bg-indigo-700 transition-all transform active:scale-[0.98] flex items-center justify-center gap-2 mt-2 shadow-lg shadow-indigo-100 disabled:opacity-50"
            >
              {loading ? <Loader2 className="animate-spin w-5 h-5" /> : (isForgot ? 'Update Password' : (isLogin ? 'Sign In' : 'Create Account'))}
            </button>
          </form>

          <div className="mt-8 flex flex-col items-center gap-4">
            <button
              type="button"
              onClick={() => {
                setIsLogin(!isLogin);
                setIsForgot(false);
              }}
              className="text-xs font-bold uppercase tracking-widest text-slate-400 hover:text-indigo-600 transition-colors"
            >
              {isLogin ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
            </button>
            
            {isLogin && (
              <button
                type="button"
                onClick={() => setIsForgot(!isForgot)}
                className="text-[10px] font-bold uppercase tracking-widest text-slate-300 hover:text-indigo-600 transition-colors"
              >
                {isForgot ? "Back to Login" : "Forgot Password?"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
