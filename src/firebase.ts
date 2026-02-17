// src/firebase.js
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDdm4GPmoktNZWALFJRDtNwVP_tKqJOXQE",
  authDomain: "go-c253a.firebaseapp.com",
  projectId: "go-c253a",
  storageBucket: "go-c253a.firebasestorage.app",
  messagingSenderId: "69694367187",
  appId: "1:69694367187:web:f18616cac313fc218e7b26",
  measurementId: "G-959DH3ZYDM"
};
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();
export const db = getFirestore(app);

export const signInWithGoogle = () => signInWithPopup(auth, provider);
export const logout = () => signOut(auth);