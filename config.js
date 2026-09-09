/* ─────────────────────────────────────────────────────────
   설정 파일 — 여기만 고치면 됩니다.

   [1] firebase
       비워 두면 "혼자 연습" 모드로 켜집니다.
       같은 기기의 여러 탭끼리만 맞춰지고, 다른 기기와는 연결되지 않습니다.

       여러 기기로 수업하려면 Firebase 실시간 데이터베이스를 만들고,
       아래 null 자리에 설정값을 그대로 붙여 넣으세요.
       만드는 방법은 README.md에 있습니다.

   [2] defaultRoom
       방 번호의 기본값입니다. 학급 이름을 넣어 두면 편합니다.

   [3] purse / step
       학생 한 명에게 주는 돈과, 한 번에 움직이는 단위입니다.
   ───────────────────────────────────────────────────────── */

window.QA_CONFIG = {

firebase: {
  apiKey: "AIzaSyA3rs8ayBY2UQdBzjXaO2YO7b4bTZc6KFM",
  authDomain: "question-auction.firebaseapp.com",
  databaseURL: "https://question-auction-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "question-auction",
  storageBucket: "question-auction.firebasestorage.app",
  messagingSenderId: "566767314848",
  appId: "1:566767314848:web:f301bf46b7e8922fc726c5"
},

  defaultRoom: "6학년",

  purse: 1000,
  step: 100
};
