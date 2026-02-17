// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { 
  Plus, Trash2, CheckCircle2, Circle, LogOut, Loader2, Trophy, Flame, Globe 
} from 'lucide-react';

// Firebase Imports
import { auth, db, signInWithGoogle, logout } from './firebase';
import { 
  collection, addDoc, query, where, onSnapshot, 
  doc, updateDoc, deleteDoc, arrayUnion, setDoc, increment, getDoc 
} from 'firebase/firestore';

// --- GLOBAL SYNC LOGIC (UTC) ---

// 1. Get the ISO Week ID based on UTC (Universal Time)
// This ensures everyone sees the same "Week Number" regardless of timezone
const getUTCWeekId = () => {
  const now = new Date();
  // Create a copy of the date in UTC
  const date = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  // Set to nearest Thursday: current date + 4 - current day number
  // Make Sunday's day number 7
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  // Get first day of year
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  // Calculate full weeks to nearest Thursday
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  
  return `${date.getUTCFullYear()}-W${weekNo}`;
};

// 2. Count down to next Monday 00:00 UTC
const getTimeUntilUTCReset = () => {
  const now = new Date();
  const currentDayUTC = now.getUTCDay(); // 0 (Sun) to 6 (Sat)
  
  // Calculate days until next Monday (1)
  // If today is Monday (1), we want 7 days. If Sunday (0), we want 1 day.
  const daysUntilMonday = (1 + 7 - currentDayUTC) % 7 || 7;
  
  const nextMonday = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + daysUntilMonday,
    0, 0, 0, 0 
  ));

  return nextMonday.getTime() - now.getTime();
};

// --- Component: Login Screen ---
const LoginScreen = () => (
  <div className="h-screen flex flex-col items-center justify-center bg-slate-900 text-white gap-6">
    <h1 className="text-5xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
      Squad Weekly
    </h1>
    <button 
      onClick={signInWithGoogle}
      className="flex items-center gap-3 bg-white text-slate-900 px-8 py-4 rounded-full font-bold text-lg hover:bg-slate-200 transition-all"
    >
      <img src="https://www.google.com/favicon.ico" alt="G" className="w-6 h-6" />
      Sign in with Google
    </button>
  </div>
);

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState([]);
  const [allUsers, setAllUsers] = useState({}); 
  const [newTask, setNewTask] = useState("");
  const [timeLeft, setTimeLeft] = useState("");
  
  // Gets a consistent ID for everyone (e.g. "2026-W08")
  const weekId = getUTCWeekId();

  // 1. Auth & Initial Setup
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (currentUser) => {
      setUser(currentUser);
      setLoading(false);

      if (currentUser) {
        try {
          const userRef = doc(db, "users", currentUser.uid);
          const snap = await getDoc(userRef);
          if (!snap.exists()) {
            await setDoc(userRef, {
              displayName: currentUser.displayName || "Anonymous",
              photoURL: currentUser.photoURL || "",
              totalScore: 0
            });
          }
        } catch (err) {
          console.error("Background sync error:", err);
        }
      }
    });
    return () => unsubscribe();
  }, []);

  // 2. Timer (Auto-Refresh Logic)
  useEffect(() => {
    const timer = setInterval(() => {
      const diff = getTimeUntilUTCReset();
      
      if (diff <= 0) {
        setTimeLeft('Resetting...');
        // Force reload to switch to the new Week ID
        window.location.reload();
      } else {
        const d = Math.floor(diff / (1000 * 60 * 60 * 24));
        const h = Math.floor((diff / (1000 * 60 * 60)) % 24);
        const m = Math.floor((diff / (1000 * 60)) % 60);
        const s = Math.floor((diff / 1000) % 60);
        setTimeLeft(`${d}d ${h}h ${m}m ${s}s`);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // 3. Listen to Tasks (Current UTC Week Only)
  useEffect(() => {
    if (!user) return;
    
    // This query is the magic. It only asks for tasks that match THIS week ID.
    // When weekId changes, this returns 0 tasks = "Vanish" effect.
    const q = query(collection(db, "tasks"), where("weekId", "==", weekId));
    
    return onSnapshot(q, (snapshot) => {
      const tasksData = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      tasksData.sort((a, b) => a.createdAt - b.createdAt);
      setTasks(tasksData);
    });
  }, [user, weekId]);

  // 4. Listen to Leaderboard
  useEffect(() => {
    if (!user) return;
    return onSnapshot(collection(db, "users"), (snapshot) => {
      const usersData = {};
      snapshot.forEach(doc => {
        usersData[doc.id] = doc.data();
      });
      setAllUsers(usersData);
    });
  }, [user]);

  // --- Actions ---

  const addTask = async (e) => {
    e.preventDefault();
    if (!newTask.trim()) return;
    
    try {
      await addDoc(collection(db, "tasks"), {
        text: newTask,
        weekId: weekId, // Saves with the UTC Week ID
        createdAt: Date.now(),
        createdBy: user.uid,
        creatorName: user.displayName,
        completedBy: []
      });
      setNewTask("");
    } catch (err) {
      console.error("Error adding task:", err);
    }
  };

  const toggleTask = async (task) => {
    const taskRef = doc(db, "tasks", task.id);
    const userRef = doc(db, "users", user.uid);
    const isCompletedByMe = task.completedBy?.some(u => u.uid === user.uid);

    if (document.body.style.cursor === 'wait') return;
    document.body.style.cursor = 'wait';

    try {
      if (isCompletedByMe) {
        const newCompletedBy = task.completedBy.filter(u => u.uid !== user.uid);
        await updateDoc(taskRef, { completedBy: newCompletedBy });
        await updateDoc(userRef, { totalScore: increment(-1) });
      } else {
        await updateDoc(taskRef, {
          completedBy: arrayUnion({
            uid: user.uid,
            photoURL: user.photoURL,
            name: user.displayName
          })
        });
        await updateDoc(userRef, { totalScore: increment(1) });
      }
    } catch (err) {
      console.error("Error toggling task:", err);
    } finally {
      document.body.style.cursor = 'default';
    }
  };

  const deleteTask = async (id) => {
    if (confirm("Delete this task?")) await deleteDoc(doc(db, "tasks", id));
  };

  // --- Stats ---
  const getLeaderboard = () => {
    const userIds = new Set([...Object.keys(allUsers)]);
    return Array.from(userIds).map(uid => {
      const userData = allUsers[uid] || { displayName: 'Unknown', totalScore: 0, photoURL: '' };
      const weeklyScore = tasks.reduce((acc, task) => {
        return acc + (task.completedBy?.some(u => u.uid === uid) ? 1 : 0);
      }, 0);
      return { uid, ...userData, weeklyScore };
    }).sort((a, b) => b.totalScore - a.totalScore);
  };

  if (loading) return <div className="h-screen flex items-center justify-center bg-slate-900 text-white"><Loader2 className="animate-spin" /></div>;
  if (!user) return <LoginScreen />;

  const leaderboard = getLeaderboard();

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 md:py-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-8 gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
            {user.displayName?.split(' ')[0]}'s Squad
          </h1>
          <div className="flex items-center gap-2 text-slate-400 text-sm mt-1">
             <Globe size={12} />
             <span>UTC Week {weekId} • Resets in <span className="text-indigo-400 font-mono font-bold">{timeLeft}</span></span>
          </div>
        </div>
        <button onClick={logout} className="text-slate-500 hover:text-white text-sm flex items-center gap-2">
          <LogOut size={16} /> Sign Out
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Tasks Column */}
        <div className="md:col-span-2">
          <form onSubmit={addTask} className="glass p-2 rounded-2xl mb-6 flex gap-2 shadow-xl border border-white/10 bg-slate-800/50">
            <input
              type="text"
              placeholder="Add a task..."
              className="flex-1 bg-transparent border-none outline-none text-white placeholder-slate-500 px-4"
              value={newTask}
              onChange={(e) => setNewTask(e.target.value)}
            />
            <button type="submit" className="bg-indigo-600 hover:bg-indigo-500 text-white w-12 h-12 rounded-xl flex items-center justify-center transition-all active:scale-95">
              <Plus />
            </button>
          </form>

          <div className="space-y-3">
            {tasks.map(task => {
              const isDone = task.completedBy?.some(u => u.uid === user.uid);
              return (
                <div key={task.id} className={`group relative flex flex-col p-4 rounded-xl border transition-all duration-300 ${isDone ? 'bg-emerald-900/10 border-emerald-500/20' : 'bg-slate-800/40 border-white/5 hover:border-white/10'}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <button onClick={() => toggleTask(task)} className={`flex-shrink-0 transition-colors ${isDone ? 'text-emerald-400' : 'text-slate-600 hover:text-indigo-400'}`}>
                        {isDone ? <CheckCircle2 size={24} /> : <Circle size={24} />}
                      </button>
                      <span className={`text-lg ${isDone ? 'line-through text-slate-500' : 'text-slate-200'}`}>{task.text}</span>
                    </div>
                    {task.createdBy === user.uid && (
                      <button onClick={() => deleteTask(task.id)} className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 transition-opacity">
                        <Trash2 size={18} />
                      </button>
                    )}
                  </div>
                  {task.completedBy?.length > 0 && (
                    <div className="mt-3 ml-10 flex items-center gap-2">
                      <div className="flex -space-x-2">
                        {task.completedBy.map((u, i) => (
                          <img key={i} src={u.photoURL} title={u.name} className="w-6 h-6 rounded-full border-2 border-slate-900" alt={u.name} />
                        ))}
                      </div>
                      <span className="text-xs text-slate-500">{task.completedBy.length} completed</span>
                    </div>
                  )}
                </div>
              );
            })}
            {tasks.length === 0 && <div className="text-center py-12 text-slate-600 italic">No tasks yet.</div>}
          </div>
        </div>

        {/* Leaderboard Column */}
        <div className="md:col-span-1">
          <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-5 sticky top-6">
            <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
              <Trophy className="text-yellow-400 w-5 h-5" /> Leaderboard
            </h2>
            <div className="space-y-4">
              {leaderboard.map((u, index) => (
                <div key={u.uid} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="relative">
                       <img src={u.photoURL || `https://ui-avatars.com/api/?name=${u.displayName}`} className="w-10 h-10 rounded-full border border-white/10" alt="avatar" />
                       {index === 0 && <div className="absolute -top-2 -right-1 text-yellow-400"><Trophy size={14} fill="currentColor" /></div>}
                    </div>
                    <div>
                      <div className="font-medium text-slate-200 text-sm">{u.displayName}</div>
                      <div className="text-xs text-slate-500 flex items-center gap-1">
                        <Flame size={10} className="text-orange-400" /> {u.weeklyScore} this week
                      </div>
                    </div>
                  </div>
                  <div className="text-indigo-400 font-bold font-mono">
                    {u.totalScore || 0}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}