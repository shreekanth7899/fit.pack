// FitPack Firebase Config
const firebaseConfig = {
  apiKey: "AIzaSyCijh73pmJ-2-4_qNeUPgZOOhlNQ_4uiTU",
  authDomain: "fitpack7899.firebaseapp.com",
  databaseURL: "https://fitpack7899-default-rtdb.firebaseio.com/",
  projectId: "fitpack7899",
  storageBucket: "fitpack7899.firebasestorage.app",
  messagingSenderId: "610097824657",
  appId: "1:610097824657:web:acf1d73d97e601b7815030"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();
console.log("🔥 FitPack Firebase ready");
