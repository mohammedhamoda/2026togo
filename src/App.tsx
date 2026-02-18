// @ts-nocheck
import React, { useState, useEffect, useMemo } from 'react';
import { 
  Plus, Trash2, CheckCircle2, Circle, LogOut, Loader2, Trophy, Flame, Globe, Link as LinkIcon, ExternalLink, X, Palette, Layers
} from 'lucide-react';

// Firebase Imports
import { auth, db, signInWithGoogle, logout } from './firebase';
import { 
  collection, addDoc, query, where, onSnapshot, 
  doc, updateDoc, deleteDoc, arrayUnion, arrayRemove, setDoc, increment, getDoc 
} from 'firebase/firestore';

// --- CONFIG ---
const PRESET_COLORS = [
  { name: 'Red', value: '#ef4444' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Amber', value: '#f59e0b' },
  { name: 'Green', value: '#22c55e' },
  { name: 'Emerald', value: '#10b981' },
  { name: 'Teal', value: '#14b8a6' },
  { name: 'Cyan', value: '#06b6d4' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Indigo', value: '#6366f1' },
  { name: 'Violet', value: '#8b5cf6' },
  { name: 'Purple', value: '#a855f7' },
  { name: 'Fuchsia', value: '#d946ef' },
  { name: 'Pink', value: '#ec4899' },
  { name: 'Rose', value: '#f43f5e' },
];

// --- GLOBAL SYNC LOGIC (UTC) ---
const getUTCWeekId = () => {
  const now = new Date();
  const date = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${weekNo}`;
};

const getTimeUntilUTCReset = () => {
  const now = new Date();
  const currentDayUTC = now.getUTCDay(); 
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
  
  // -- CATEGORY STATES --
  const [categoryMode, setCategoryMode] = useState('existing'); // 'existing' or 'new'
  const [selectedCategory, setSelectedCategory] = useState("");
  const [newCatName, setNewCatName] = useState("");
  const [newCatColor, setNewCatColor] = useState(PRESET_COLORS[8].value); // Default Indigo

  // State for managing which task has its resource section open
  const [expandedTaskId, setExpandedTaskId] = useState(null);
  const [newResourceUrl, setNewResourceUrl] = useState("");
  const [newResourceTitle, setNewResourceTitle] = useState("");

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

  // 2. Timer (Auto-Refresh)
  useEffect(() => {
    const timer = setInterval(() => {
      const diff = getTimeUntilUTCReset();
      if (diff <= 0) {
        setTimeLeft('Resetting...');
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

  // 3. Listen to Tasks
  useEffect(() => {
    if (!user) return;
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

  // --- Derived State: Group Tasks & Extract Unique Categories ---
  const { groupedTasks, uniqueCategories } = useMemo(() => {
    const groups = {};
    const categories = new Map(); // Use map to store catName -> color

    tasks.forEach(task => {
      const catName = task.category || "General";
      const catColor = task.color || "#64748b"; // Slate-500 default

      if (!groups[catName]) {
        groups[catName] = { color: catColor, tasks: [] };
        categories.set(catName, catColor);
      }
      groups[catName].tasks.push(task);
    });

    return { 
      groupedTasks: groups, 
      uniqueCategories: Array.from(categories.entries()).map(([name, color]) => ({ name, color })) 
    };
  }, [tasks]);

  // Force "New Category" mode if no categories exist yet
  useEffect(() => {
    if (uniqueCategories.length === 0) {
      setCategoryMode('new');
    } else if (categoryMode === 'existing' && !selectedCategory) {
      // Select the first one by default if existing mode
      setSelectedCategory(uniqueCategories[0].name);
    }
  }, [uniqueCategories, categoryMode]);


  // --- Actions ---

  const addTask = async (e) => {
    e.preventDefault();
    if (!newTask.trim()) return;

    let finalCategory = "General";
    let finalColor = "#64748b";

    if (categoryMode === 'new') {
      if (!newCatName.trim()) return alert("Please enter a category name");
      finalCategory = newCatName.trim();
      finalColor = newCatColor;
    } else {
      if (!selectedCategory) return alert("Please select a category");
      finalCategory = selectedCategory;
      // Find color of existing category
      const existing = uniqueCategories.find(c => c.name === selectedCategory);
      finalColor = existing ? existing.color : "#64748b";
    }

    try {
      await addDoc(collection(db, "tasks"), {
        text: newTask,
        weekId: weekId,
        createdAt: Date.now(),
        createdBy: user.uid,
        creatorName: user.displayName,
        completedBy: [],
        resources: [],
        category: finalCategory,
        color: finalColor
      });
      setNewTask("");
      // Reset logic: keep it on the category they just used, or clear if it was new
      if(categoryMode === 'new') {
        setSelectedCategory(finalCategory);
        setCategoryMode('existing');
        setNewCatName("");
      }
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
    if (!confirm("Are you sure you want to delete this task?")) return;
    try {
      await deleteDoc(doc(db, "tasks", id));
    } catch (err) {
      alert("⛔ Access Denied: Only the Admin can delete tasks.");
    }
  };

  // --- Resource Actions ---

  const addResource = async (taskId) => {
    if (!newResourceUrl.trim()) return;
    
    let url = newResourceUrl.trim();
    if (!/^https?:\/\//i.test(url)) {
        url = 'https://' + url;
    }

    const title = newResourceTitle.trim() || url; 

    try {
      const taskRef = doc(db, "tasks", taskId);
      await updateDoc(taskRef, {
        resources: arrayUnion({
          url: url,
          title: title,
          addedBy: user.displayName,
          addedAt: Date.now()
        })
      });
      setNewResourceUrl("");
      setNewResourceTitle("");
    } catch (err) {
      console.error("Error adding resource:", err);
    }
  };

  const deleteResource = async (taskId, resourceObj) => {
    if(!confirm("Remove this link?")) return;
    try {
      const taskRef = doc(db, "tasks", taskId);
      await updateDoc(taskRef, {
        resources: arrayRemove(resourceObj)
      });
    } catch (err) {
      console.error("Error removing resource:", err);
    }
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
    <div className="max-w-6xl mx-auto px-4 py-8 md:py-12">
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

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Tasks Column */}
        <div className="lg:col-span-3">
          
          {/* --- ADD TASK FORM --- */}
          <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-4 mb-8 shadow-xl">
             <form onSubmit={addTask} className="flex flex-col gap-4">
                
                {/* 1. Category Selector */}
                <div className="flex flex-wrap gap-4 items-center pb-4 border-b border-white/5">
                   <div className="flex bg-slate-900/50 rounded-lg p-1">
                      {uniqueCategories.length > 0 && (
                        <button 
                          type="button"
                          onClick={() => setCategoryMode('existing')}
                          className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${categoryMode === 'existing' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
                        >
                          Existing Category
                        </button>
                      )}
                      <button 
                         type="button"
                         onClick={() => setCategoryMode('new')}
                         className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${categoryMode === 'new' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
                      >
                         <div className="flex items-center gap-1"><Plus size={12}/> New Category</div>
                      </button>
                   </div>

                   {/* Existing Dropdown */}
                   {categoryMode === 'existing' && uniqueCategories.length > 0 && (
                      <div className="flex items-center gap-2 flex-1">
                         <Layers size={16} className="text-slate-500" />
                         <select 
                            value={selectedCategory} 
                            onChange={(e) => setSelectedCategory(e.target.value)}
                            className="bg-slate-900 border border-white/10 text-white text-sm rounded-lg px-3 py-2 outline-none focus:border-indigo-500 w-full md:w-auto min-w-[200px]"
                         >
                            {uniqueCategories.map(cat => (
                              <option key={cat.name} value={cat.name}>{cat.name}</option>
                            ))}
                         </select>
                      </div>
                   )}

                   {/* New Category Inputs */}
                   {categoryMode === 'new' && (
                      <div className="flex flex-wrap items-center gap-2 flex-1 animate-in fade-in slide-in-from-left-2 duration-300">
                         <input 
                            type="text"
                            placeholder="Category Name (e.g., Marketing)"
                            className="bg-slate-900 border border-white/10 text-white text-sm rounded-lg px-3 py-2 outline-none focus:border-indigo-500 min-w-[150px]"
                            value={newCatName}
                            onChange={(e) => setNewCatName(e.target.value)}
                         />
                         
                         {/* Color Picker Swatches */}
                         <div className="flex items-center gap-1 bg-slate-900/50 p-1.5 rounded-lg border border-white/5">
                            <Palette size={14} className="text-slate-500 mr-1" />
                            {PRESET_COLORS.map((c) => (
                               <button
                                  key={c.value}
                                  type="button"
                                  onClick={() => setNewCatColor(c.value)}
                                  className={`w-4 h-4 rounded-full transition-transform hover:scale-125 ${newCatColor === c.value ? 'ring-2 ring-white scale-110' : 'opacity-70'}`}
                                  style={{ backgroundColor: c.value }}
                                  title={c.name}
                               />
                            ))}
                         </div>
                      </div>
                   )}
                </div>

                {/* 2. Task Input */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="What needs to be done?"
                    className="flex-1 bg-transparent border-none outline-none text-white placeholder-slate-500 px-2 text-lg"
                    value={newTask}
                    onChange={(e) => setNewTask(e.target.value)}
                  />
                  <button type="submit" className="bg-white text-slate-900 w-10 h-10 rounded-xl flex items-center justify-center font-bold hover:bg-indigo-50 transition-all active:scale-95">
                    <Plus />
                  </button>
                </div>
             </form>
          </div>

          {/* --- GROUPED TASKS DISPLAY --- */}
          <div className="space-y-8">
            {Object.entries(groupedTasks).map(([catName, groupData]) => (
              <div key={catName} className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                {/* Category Header */}
                <div className="flex items-center gap-3 mb-4 pl-2">
                  <div className="w-3 h-8 rounded-full " style={{ backgroundColor: groupData.color }}></div>
                  <h3 className="text-xl font-bold text-slate-200">{catName}</h3>
                  <span className="text-xs text-slate-500 bg-slate-800 px-2 py-1 rounded-full">{groupData.tasks.length} tasks</span>
                </div>

                {/* Tasks in this Category */}
                <div className="space-y-3">
                    {groupData.tasks.map(task => {
                      const isDone = task.completedBy?.some(u => u.uid === user.uid);
                      const isExpanded = expandedTaskId === task.id;

                      return (
                        <div key={task.id} 
                             className={`group relative flex flex-col p-4 rounded-xl border transition-all duration-300 
                             ${isDone ? 'bg-emerald-900/10 border-emerald-500/20' : 'bg-slate-800/40 border-white/5 hover:border-white/10'}`}
                             style={{ borderLeft: `4px solid ${isDone ? '#10b981' : task.color}` }}
                        >
                          
                          {/* Task Top Row */}
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex items-center gap-4 flex-1">
                              <button onClick={() => toggleTask(task)} className={`flex-shrink-0 transition-colors ${isDone ? 'text-emerald-400' : 'text-slate-600 hover:text-indigo-400'}`}>
                                {isDone ? <CheckCircle2 size={24} /> : <Circle size={24} />}
                              </button>
                              <span className={`text-lg ${isDone ? 'line-through text-slate-500' : 'text-slate-200'}`}>{task.text}</span>
                            </div>
                            
                            <div className="flex items-center gap-1 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                                {/* Resource Toggle Button */}
                                <button 
                                    onClick={() => setExpandedTaskId(isExpanded ? null : task.id)}
                                    className={`p-2 transition-colors rounded-lg ${isExpanded ? 'text-indigo-400 bg-indigo-500/10' : 'text-slate-500 hover:text-indigo-300'}`}
                                    title="Add Resources"
                                >
                                    <LinkIcon size={18} />
                                </button>

                                {/* Delete Button */}
                                <button 
                                onClick={() => deleteTask(task.id)} 
                                className="text-slate-600 hover:text-red-400 transition-colors p-2"
                                title="Admin only"
                                >
                                <Trash2 size={18} />
                                </button>
                            </div>
                          </div>
                          
                          {/* Completion Avatars */}
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

                          {/* Expandable Resources Section */}
                          {isExpanded && (
                              <div className="mt-4 ml-10 p-4 bg-slate-900/50 rounded-lg border border-white/5">
                                  <h4 className="text-sm font-bold text-slate-400 mb-3 flex items-center gap-2">
                                      <LinkIcon size={14} /> Resources & Links
                                  </h4>

                                  {/* Existing Resources List */}
                                  <div className="space-y-2 mb-4">
                                      {task.resources?.map((res, idx) => (
                                          <div key={idx} className="flex items-center justify-between bg-slate-800/50 p-2 rounded border border-white/5 hover:border-white/10 group/link">
                                              <a href={res.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-indigo-400 hover:underline text-sm truncate max-w-[200px] md:max-w-xs">
                                                  <ExternalLink size={12} />
                                                  {res.title}
                                              </a>
                                              <div className="flex items-center gap-3">
                                                <span className="text-[10px] text-slate-600 hidden sm:inline">by {res.addedBy}</span>
                                                <button onClick={() => deleteResource(task.id, res)} className="text-slate-600 hover:text-red-400">
                                                    <X size={14} />
                                                </button>
                                              </div>
                                          </div>
                                      ))}
                                      {(!task.resources || task.resources.length === 0) && (
                                          <p className="text-xs text-slate-600 italic">No resources added yet.</p>
                                      )}
                                  </div>

                                  {/* Add New Resource Form */}
                                  <div className="flex flex-col gap-2">
                                      <input 
                                          type="text" 
                                          placeholder="Link Title (e.g. Tutorial Video)" 
                                          className="bg-slate-800 border-none outline-none text-white text-xs px-3 py-2 rounded focus:ring-1 focus:ring-indigo-500"
                                          value={newResourceTitle}
                                          onChange={e => setNewResourceTitle(e.target.value)}
                                      />
                                      <div className="flex gap-2">
                                          <input 
                                              type="text" 
                                              placeholder="https://..." 
                                              className="flex-1 bg-slate-800 border-none outline-none text-white text-xs px-3 py-2 rounded focus:ring-1 focus:ring-indigo-500"
                                              value={newResourceUrl}
                                              onChange={e => setNewResourceUrl(e.target.value)}
                                          />
                                          <button 
                                              onClick={() => addResource(task.id)}
                                              className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-3 py-2 rounded font-medium"
                                          >
                                              Add
                                          </button>
                                      </div>
                                  </div>
                              </div>
                          )}

                        </div>
                      );
                    })}
                </div>
              </div>
            ))}

            {tasks.length === 0 && <div className="text-center py-12 text-slate-600 italic">No tasks yet. Create a category to get started.</div>}
          </div>
        </div>

        {/* Leaderboard Column */}
        <div className="lg:col-span-1">
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