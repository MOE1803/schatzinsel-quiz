const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcrypt');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// In-Memory Datenbank
let users = [];
let groups = [];
let questions = [];
let categories = ['Mathematik', 'Informatik', 'Geschichte', 'Naturwissenschaften'];
let pendingQuestions = []; // Fragen warten auf Admin-Freigabe
let chatMessages = {};
let currentUserId = 1;
let currentGroupId = 1;

// Beispiel-Fragen für jede Kategorie
const sampleQuestions = {
  'Mathematik': [
    {
      id: 1,
      question: "Was ist 15 × 8?",
      options: ["120", "125", "115", "130"],
      correct: 0,
      category: "Mathematik",
      approved: true,
      createdBy: "System"
    },
    {
      id: 2,
      question: "Was ist die Ableitung von x²?",
      options: ["2x", "x", "2", "x²"],
      correct: 0,
      category: "Mathematik",
      approved: true,
      createdBy: "System"
    }
  ],
  'Informatik': [
    {
      id: 3,
      question: "Was bedeutet HTML?",
      options: ["HyperText Markup Language", "High Tech Modern Language", "Home Tool Markup Language", "Hyperlink Text Management Language"],
      correct: 0,
      category: "Informatik",
      approved: true,
      createdBy: "System"
    },
    {
      id: 4,
      question: "Welche Programmiersprache wird hauptsächlich für Webentwicklung verwendet?",
      options: ["Python", "JavaScript", "C++", "Java"],
      correct: 1,
      category: "Informatik",
      approved: true,
      createdBy: "System"
    }
  ]
};

// Sample Questions initialisieren
Object.values(sampleQuestions).forEach(categoryQuestions => {
  questions.push(...categoryQuestions);
});

// Utility Funktionen
const generateId = () => Math.random().toString(36).substr(2, 9);
const hashPassword = async (password) => await bcrypt.hash(password, 10);
const comparePassword = async (password, hash) => await bcrypt.compare(password, hash);

// Gruppe finden oder erstellen
const findOrCreateGroup = (category) => {
  // Suche nach Gruppe mit weniger als 5 Mitgliedern
  let availableGroup = groups.find(group => 
    group.category === category && 
    group.members.length < 5 && 
    group.status === 'waiting'
  );
  
  if (!availableGroup) {
    availableGroup = {
      id: currentGroupId++,
      category,
      members: [],
      status: 'waiting', // waiting, playing, finished
      currentQuestion: 0,
      scores: {},
      createdAt: new Date().toISOString()
    };
    groups.push(availableGroup);
    chatMessages[availableGroup.id] = [];
  }
  
  return availableGroup;
};

// Socket.IO für Echtzeit-Chat
io.on('connection', (socket) => {
  console.log(`👥 Nutzer verbunden: ${socket.id}`);
  
  // Nutzer einer Gruppe beitreten lassen
  socket.on('joinGroup', (data) => {
    const { userId, groupId } = data;
    const user = users.find(u => u.id === userId);
    const group = groups.find(g => g.id === groupId);
    
    if (user && group) {
      socket.join(`group_${groupId}`);
      socket.userId = userId;
      socket.groupId = groupId;
      
      // Begrüßungsnachricht
      const welcomeMessage = {
        id: generateId(),
        userId: 'system',
        username: 'Käpt\'n Blackbeard',
        message: `🏴‍☠️ ${user.username} ist der Crew beigetreten! Ahoi!`,
        timestamp: new Date().toISOString(),
        type: 'system'
      };
      
      chatMessages[groupId].push(welcomeMessage);
      io.to(`group_${groupId}`).emit('newMessage', welcomeMessage);
      
      // Chat-Historie senden
      socket.emit('chatHistory', chatMessages[groupId] || []);
      
      console.log(`👤 ${user.username} joined Group ${groupId}`);
    }
  });
  
  // Chat-Nachricht empfangen
  socket.on('sendMessage', (data) => {
    const { message } = data;
    const user = users.find(u => u.id === socket.userId);
    const groupId = socket.groupId;
    
    if (user && groupId && message.trim()) {
      const chatMessage = {
        id: generateId(),
        userId: user.id,
        username: user.username,
        avatar: user.avatar,
        message: message.trim(),
        timestamp: new Date().toISOString(),
        type: 'user'
      };
      
      chatMessages[groupId].push(chatMessage);
      
      // Nachricht an alle Gruppenmitglieder senden
      io.to(`group_${groupId}`).emit('newMessage', chatMessage);
      
      console.log(`💬 ${user.username} in Group ${groupId}: ${message}`);
    }
  });
  
  // Quiz-Ergebnis teilen
  socket.on('shareResult', (data) => {
    const { score, totalQuestions } = data;
    const user = users.find(u => u.id === socket.userId);
    const groupId = socket.groupId;
    
    if (user && groupId) {
      const resultMessage = {
        id: generateId(),
        userId: 'system',
        username: 'Quiz-Master',
        message: `🏆 ${user.username} hat ${score}/${totalQuestions} Fragen richtig beantwortet! ${score} Goldtaler gewonnen! 💰`,
        timestamp: new Date().toISOString(),
        type: 'result'
      };
      
      chatMessages[groupId].push(resultMessage);
      io.to(`group_${groupId}`).emit('newMessage', resultMessage);
    }
  });
  
  socket.on('disconnect', () => {
    console.log(`👋 Nutzer getrennt: ${socket.id}`);
  });
});

// REST API Routen

// Startseite
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="de">
    <head>
        <meta charset="UTF-8">
        <title>Kooperatives Lern-Quiz System</title>
        <style>
            body { 
                font-family: 'Arial', sans-serif; 
                background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
                color: white; text-align: center; padding: 50px; min-height: 100vh;
            }
            .container { 
                max-width: 800px; margin: 0 auto; 
                background: rgba(255,255,255,0.1); padding: 3rem; border-radius: 20px;
                backdrop-filter: blur(10px);
            }
            h1 { font-size: 3em; margin-bottom: 30px; }
            .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 30px 0; }
            .stat-card { background: rgba(76, 175, 80, 0.2); padding: 20px; border-radius: 15px; border: 2px solid #4CAF50; }
            .btn { display: inline-block; background: #4CAF50; color: white; padding: 15px 30px; text-decoration: none; border-radius: 50px; margin: 10px; font-size: 1.1rem; transition: all 0.3s; }
            .btn:hover { background: #357638; transform: translateY(-2px); }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🏴‍☠️ Kooperatives Lern-Quiz System ⚓</h1>
            <p>Lernen Sie gemeinsam und spielerisch in Gruppen!</p>
            
            <div class="stats">
                <div class="stat-card">
                    <h3>👥 Registrierte Piraten</h3>
                    <p style="font-size: 2em;">${users.length}</p>
                </div>
                <div class="stat-card">
                    <h3>⚔️ Aktive Gruppen</h3>
                    <p style="font-size: 2em;">${groups.filter(g => g.status !== 'finished').length}</p>
                </div>
                <div class="stat-card">
                    <h3>📚 Verfügbare Fragen</h3>
                    <p style="font-size: 2em;">${questions.filter(q => q.approved).length}</p>
                </div>
                <div class="stat-card">
                    <h3>⏳ Wartende Fragen</h3>
                    <p style="font-size: 2em;">${pendingQuestions.length}</p>
                </div>
            </div>
            
            <div>
                <a href="register.html" class="btn">🚀 Registrieren</a>
                <a href="login.html" class="btn">🔑 Einloggen</a>
                <a href="admin.html" class="btn" style="background: #FF9800;">👑 Admin</a>
            </div>
        </div>
    </body>
    </html>
  `);
});

// Benutzer registrieren
app.post('/api/register', async (req, res) => {
  try {
    const { prename, surname, username, email, password, avatar } = req.body;
    
    if (!prename || !surname || !username || !email || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Alle Felder sind erforderlich' 
      });
    }
    
    // Prüfen ob Username oder Email bereits existiert
    if (users.find(user => user.username === username)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Benutzername bereits vergeben' 
      });
    }
    
    if (users.find(user => user.email === email)) {
      return res.status(400).json({ 
        success: false, 
        message: 'E-Mail bereits registriert' 
      });
    }
    
    const hashedPassword = await hashPassword(password);
    
    const newUser = {
      id: currentUserId++,
      prename,
      surname,
      username,
      email,
      password: hashedPassword,
      avatar: avatar || 'avatar1.jpeg',
      role: 'student', // student, admin
      totalGoldtaler: 0,
      completedQuizzes: 0,
      createdAt: new Date().toISOString()
    };
    
    users.push(newUser);
    console.log(`✅ Neuer Pirat registriert: ${username}`);
    
    res.json({ 
      success: true, 
      message: 'Registrierung erfolgreich! Willkommen an Bord!',
      user: { ...newUser, password: undefined }
    });
    
  } catch (error) {
    console.error('Registrierung Fehler:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server Fehler bei der Registrierung' 
    });
  }
});

// Benutzer einloggen
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    const user = users.find(u => u.username === username);
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Ungültiger Benutzername oder Passwort' 
      });
    }
    
    const isValidPassword = await comparePassword(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ 
        success: false, 
        message: 'Ungültiger Benutzername oder Passwort' 
      });
    }
    
    res.json({ 
      success: true, 
      message: 'Erfolgreich eingeloggt!',
      user: { ...user, password: undefined }
    });
    
  } catch (error) {
    console.error('Login Fehler:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server Fehler beim Login' 
    });
  }
});

// Kategorien abrufen
app.get('/api/categories', (req, res) => {
  res.json({
    success: true,
    categories: categories.map(cat => ({
      name: cat,
      questionCount: questions.filter(q => q.category === cat && q.approved).length,
      activeGroups: groups.filter(g => g.category === cat && g.status !== 'finished').length
    }))
  });
});

// Gruppe beitreten
app.post('/api/join-group', (req, res) => {
  try {
    const { userId, category } = req.body;
    
    const user = users.find(u => u.id === userId);
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'Benutzer nicht gefunden' 
      });
    }
    
    // Prüfen ob User bereits in einer aktiven Gruppe ist
    const existingGroup = groups.find(g => 
      g.members.includes(userId) && g.status !== 'finished'
    );
    
    if (existingGroup) {
      return res.json({
        success: true,
        message: 'Bereits in Gruppe',
        group: existingGroup
      });
    }
    
    const group = findOrCreateGroup(category);
    
    if (!group.members.includes(userId)) {
      group.members.push(userId);
      group.scores[userId] = 0;
    }
    
    // Wenn Gruppe voll ist, Status auf 'ready' setzen
    if (group.members.length >= 2) { // Minimum 2 für Test, normalerweise 5
      group.status = 'ready';
    }
    
    res.json({
      success: true,
      message: `Erfolgreich Gruppe beigetreten! ${group.members.length}/5 Piraten`,
      group: {
        ...group,
        memberDetails: group.members.map(memberId => {
          const member = users.find(u => u.id === memberId);
          return member ? { 
            id: member.id, 
            username: member.username, 
            avatar: member.avatar 
          } : null;
        }).filter(Boolean)
      }
    });
    
  } catch (error) {
    console.error('Gruppe beitreten Fehler:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Fehler beim Beitreten der Gruppe' 
    });
  }
});

// Quiz-Fragen für Kategorie abrufen
app.get('/api/quiz/:category', (req, res) => {
  try {
    const category = req.params.category;
    const categoryQuestions = questions
      .filter(q => q.category === category && q.approved)
      .slice(0, 5)
      .map(({ correct, ...question }) => question); // Korrekte Antwort entfernen
    
    if (categoryQuestions.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Keine Fragen für diese Kategorie verfügbar'
      });
    }
    
    res.json({
      success: true,
      questions: categoryQuestions,
      total: categoryQuestions.length
    });
    
  } catch (error) {
    console.error('Quiz-Fragen Fehler:', error);
    res.status(500).json({ success: false, message: 'Server Fehler' });
  }
});

// Quiz bewerten
app.post('/api/submit-quiz', (req, res) => {
  try {
    const { userId, groupId, category, answers, timeSpent } = req.body;
    
    const user = users.find(u => u.id === userId);
    const group = groups.find(g => g.id === groupId);
    
    if (!user || !group) {
      return res.status(404).json({
        success: false,
        message: 'Benutzer oder Gruppe nicht gefunden'
      });
    }
    
    const categoryQuestions = questions.filter(q => q.category === category && q.approved).slice(0, 5);
    let score = 0;
    const results = [];
    
    answers.forEach((answer, index) => {
      const question = categoryQuestions[index];
      const isCorrect = question && answer === question.correct;
      
      if (isCorrect) score++;
      
      results.push({
        questionId: question.id,
        question: question.question,
        userAnswer: answer,
        correctAnswer: question.correct,
        isCorrect,
        options: question.options
      });
    });
    
    // Goldtaler = Score
    const goldtaler = score;
    user.totalGoldtaler += goldtaler;
    user.completedQuizzes++;
    group.scores[userId] = goldtaler;
    
    res.json({
      success: true,
      result: {
        score,
        totalQuestions: answers.length,
        goldtaler,
        percentage: Math.round((score / answers.length) * 100),
        timeSpent,
        results,
        message: `Ahoi! ${score} richtige Antworten! Du hast ${goldtaler} Goldtaler verdient! 💰`
      }
    });
    
  } catch (error) {
    console.error('Quiz-Bewertung Fehler:', error);
    res.status(500).json({ success: false, message: 'Server Fehler' });
  }
});

// Neue Frage vorschlagen
app.post('/api/suggest-question', (req, res) => {
  try {
    const { userId, category, question, options, correctAnswer } = req.body;
    
    const user = users.find(u => u.id === userId);
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: 'Benutzer nicht gefunden' 
      });
    }
    
    if (!question || !options || options.length !== 4 || correctAnswer === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Vollständige Fragendaten erforderlich (Frage, 4 Antworten, korrekte Antwort)'
      });
    }
    
    const newQuestion = {
      id: Date.now(),
      question,
      options,
      correct: correctAnswer,
      category,
      approved: false,
      createdBy: user.username,
      createdAt: new Date().toISOString()
    };
    
    pendingQuestions.push(newQuestion);
    
    res.json({
      success: true,
      message: 'Frage erfolgreich eingereicht! Sie wird vom Admin geprüft.',
      questionId: newQuestion.id
    });
    
  } catch (error) {
    console.error('Frage vorschlagen Fehler:', error);
    res.status(500).json({ success: false, message: 'Server Fehler' });
  }
});

// Admin: Wartende Fragen abrufen
app.get('/api/admin/pending-questions', (req, res) => {
  res.json({
    success: true,
    questions: pendingQuestions
  });
});

// Admin: Frage genehmigen
app.post('/api/admin/approve-question/:id', (req, res) => {
  try {
    const questionId = parseInt(req.params.id);
    const questionIndex = pendingQuestions.findIndex(q => q.id === questionId);
    
    if (questionIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Frage nicht gefunden'
      });
    }
    
    const approvedQuestion = { ...pendingQuestions[questionIndex], approved: true };
    questions.push(approvedQuestion);
    pendingQuestions.splice(questionIndex, 1);
    
    res.json({
      success: true,
      message: 'Frage genehmigt und aktiviert!',
      question: approvedQuestion
    });
    
  } catch (error) {
    console.error('Frage genehmigen Fehler:', error);
    res.status(500).json({ success: false, message: 'Server Fehler' });
  }
});

// Admin: Frage ablehnen
app.delete('/api/admin/reject-question/:id', (req, res) => {
  try {
    const questionId = parseInt(req.params.id);
    const questionIndex = pendingQuestions.findIndex(q => q.id === questionId);
    
    if (questionIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Frage nicht gefunden'
      });
    }
    
    pendingQuestions.splice(questionIndex, 1);
    
    res.json({
      success: true,
      message: 'Frage abgelehnt und entfernt'
    });
    
  } catch (error) {
    console.error('Frage ablehnen Fehler:', error);
    res.status(500).json({ success: false, message: 'Server Fehler' });
  }
});

// Benutzer-Profil abrufen
app.get('/api/profile/:id', (req, res) => {
  const user = users.find(u => u.id === parseInt(req.params.id));
  if (!user) {
    return res.status(404).json({ success: false, message: 'Benutzer nicht gefunden' });
  }
  
  res.json({
    success: true,
    profile: { ...user, password: undefined }
  });
});

// Zusätzliche Server-Routen für fehlende Features

// Admin: Benutzer verwalten (deaktivieren/aktivieren)
app.get('/api/admin/users', (req, res) => {
  try {
    const adminUser = users.find(u => u.id === parseInt(req.query.adminId));
    
    if (!adminUser || adminUser.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Keine Admin-Berechtigung'
      });
    }
    
    const userList = users.map(user => ({
      id: user.id,
      username: user.username,
      email: user.email,
      prename: user.prename,
      surname: user.surname,
      role: user.role,
      totalGoldtaler: user.totalGoldtaler,
      completedQuizzes: user.completedQuizzes,
      createdAt: user.createdAt,
      active: user.active !== false // Default: aktiv
    }));
    
    res.json({
      success: true,
      users: userList,
      total: userList.length
    });
    
  } catch (error) {
    console.error('Admin Users Fehler:', error);
    res.status(500).json({ success: false, message: 'Server Fehler' });
  }
});

// Admin: Benutzer deaktivieren/aktivieren
app.patch('/api/admin/users/:id/toggle-active', (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { adminId } = req.body;
    
    const adminUser = users.find(u => u.id === adminId);
    if (!adminUser || adminUser.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Keine Admin-Berechtigung'
      });
    }
    
    const user = users.find(u => u.id === userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Benutzer nicht gefunden'
      });
    }
    
    // Admin kann sich nicht selbst deaktivieren
    if (user.id === adminId) {
      return res.status(400).json({
        success: false,
        message: 'Sie können sich nicht selbst deaktivieren'
      });
    }
    
    user.active = user.active !== false ? false : true;
    
    res.json({
      success: true,
      message: `Benutzer ${user.active ? 'aktiviert' : 'deaktiviert'}`,
      user: {
        id: user.id,
        username: user.username,
        active: user.active
      }
    });
    
  } catch (error) {
    console.error('Toggle User Active Fehler:', error);
    res.status(500).json({ success: false, message: 'Server Fehler' });
  }
});

// User: Profil bearbeiten
app.patch('/api/profile/:id', async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { prename, surname, email, avatar, currentPassword, newPassword } = req.body;
    
    const user = users.find(u => u.id === userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Benutzer nicht gefunden'
      });
    }
    
    // Passwort ändern falls gewünscht
    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({
          success: false,
          message: 'Aktuelles Passwort erforderlich'
        });
      }
      
      const isValidPassword = await comparePassword(currentPassword, user.password);
      if (!isValidPassword) {
        return res.status(400).json({
          success: false,
          message: 'Aktuelles Passwort ist falsch'
        });
      }
      
      user.password = await hashPassword(newPassword);
    }
    
    // E-Mail-Duplikat prüfen
    if (email && email !== user.email) {
      const emailExists = users.find(u => u.email === email && u.id !== userId);
      if (emailExists) {
        return res.status(400).json({
          success: false,
          message: 'E-Mail bereits vergeben'
        });
      }
      user.email = email;
    }
    
    // Andere Felder aktualisieren
    if (prename) user.prename = prename;
    if (surname) user.surname = surname;
    if (avatar) user.avatar = avatar;
    
    user.updatedAt = new Date().toISOString();
    
    res.json({
      success: true,
      message: 'Profil erfolgreich aktualisiert',
      user: { ...user, password: undefined }
    });
    
  } catch (error) {
    console.error('Profil bearbeiten Fehler:', error);
    res.status(500).json({ success: false, message: 'Server Fehler' });
  }
});

// User: Logout (Session invalidieren)
app.post('/api/logout', (req, res) => {
  try {
    const { userId } = req.body;
    const user = users.find(u => u.id === userId);
    
    if (user) {
      user.lastLogout = new Date().toISOString();
      console.log(`👋 Benutzer ausgeloggt: ${user.username}`);
    }
    
    res.json({
      success: true,
      message: 'Erfolgreich ausgeloggt'
    });
    
  } catch (error) {
    console.error('Logout Fehler:', error);
    res.status(500).json({ success: false, message: 'Server Fehler' });
  }
});

// Kurse/Lernpfade System
let courses = [
  {
    id: 1,
    title: "Grundlagen der Mathematik",
    description: "Lerne die Basics: Addition, Subtraktion, Multiplikation",
    category: "Mathematik",
    difficulty: "Anfänger",
    estimatedTime: "30 Minuten",
    topics: ["Grundrechenarten", "Bruchrechnung", "Prozentrechnung"],
    questionIds: [1, 2], // Verweise auf Fragen
    icon: "🧮",
    active: true
  },
  {
    id: 2,
    title: "Web-Entwicklung Basics",
    description: "HTML, CSS und JavaScript für Einsteiger",
    category: "Informatik",
    difficulty: "Anfänger",
    estimatedTime: "45 Minuten",
    topics: ["HTML Grundlagen", "CSS Styling", "JavaScript Basics"],
    questionIds: [3, 4],
    icon: "💻",
    active: true
  },
  {
    id: 3,
    title: "Deutsche Geschichte",
    description: "Von der Antike bis zur Moderne",
    category: "Geschichte",
    difficulty: "Mittel",
    estimatedTime: "60 Minuten",
    topics: ["Mittelalter", "Neuzeit", "20. Jahrhundert"],
    questionIds: [],
    icon: "🏛️",
    active: true
  },
  {
    id: 4,
    title: "Physik Experimente",
    description: "Verstehe die Welt durch Experimente",
    category: "Naturwissenschaften",
    difficulty: "Fortgeschritten",
    estimatedTime: "90 Minuten",
    topics: ["Mechanik", "Optik", "Elektrizität"],
    questionIds: [],
    icon: "🔬",
    active: true
  }
];

// Kurse durchsuchen
app.get('/api/courses', (req, res) => {
  try {
    const { category, difficulty, search } = req.query;
    let filteredCourses = courses.filter(course => course.active);
    
    // Nach Kategorie filtern
    if (category) {
      filteredCourses = filteredCourses.filter(course => 
        course.category.toLowerCase() === category.toLowerCase()
      );
    }
    
    // Nach Schwierigkeit filtern
    if (difficulty) {
      filteredCourses = filteredCourses.filter(course => 
        course.difficulty.toLowerCase() === difficulty.toLowerCase()
      );
    }
    
    // Suche im Titel und Beschreibung
    if (search) {
      const searchTerm = search.toLowerCase();
      filteredCourses = filteredCourses.filter(course => 
        course.title.toLowerCase().includes(searchTerm) ||
        course.description.toLowerCase().includes(searchTerm) ||
        course.topics.some(topic => topic.toLowerCase().includes(searchTerm))
      );
    }
    
    // Statistiken für jeden Kurs hinzufügen
    const coursesWithStats = filteredCourses.map(course => ({
      ...course,
      questionCount: course.questionIds.length,
      completionRate: Math.floor(Math.random() * 100), // Simuliert
      enrolledUsers: Math.floor(Math.random() * 50) + 5 // Simuliert
    }));
    
    res.json({
      success: true,
      courses: coursesWithStats,
      total: coursesWithStats.length,
      filters: {
        categories: [...new Set(courses.map(c => c.category))],
        difficulties: [...new Set(courses.map(c => c.difficulty))]
      }
    });
    
  } catch (error) {
    console.error('Kurse durchsuchen Fehler:', error);
    res.status(500).json({ success: false, message: 'Server Fehler' });
  }
});

// Kurs Details abrufen
app.get('/api/courses/:id', (req, res) => {
  try {
    const courseId = parseInt(req.params.id);
    const course = courses.find(c => c.id === courseId && c.active);
    
    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Kurs nicht gefunden'
      });
    }
    
    // Fragen für diesen Kurs laden
    const courseQuestions = questions.filter(q => 
      course.questionIds.includes(q.id) && q.approved
    ).map(({ correct, ...question }) => question);
    
    res.json({
      success: true,
      course: {
        ...course,
        questions: courseQuestions,
        questionCount: courseQuestions.length,
        completionRate: Math.floor(Math.random() * 100),
        enrolledUsers: Math.floor(Math.random() * 50) + 5,
        reviews: Math.floor(Math.random() * 20) + 3,
        rating: (Math.random() * 2 + 3).toFixed(1) // 3.0 - 5.0
      }
    });
    
  } catch (error) {
    console.error('Kurs Details Fehler:', error);
    res.status(500).json({ success: false, message: 'Server Fehler' });
  }
});

// Admin: Ersten Admin-User erstellen (falls noch keiner existiert)
const createAdminUser = async () => {
  const adminExists = users.find(u => u.role === 'admin');
  
  if (!adminExists) {
    const adminUser = {
      id: currentUserId++,
      prename: 'System',
      surname: 'Administrator',
      username: 'admin',
      email: 'admin@schatzinsel.de',
      password: await hashPassword('admin123'), // ÄNDERN SIE DAS IN PRODUKTION!
      avatar: 'avatar1.jpeg',
      role: 'admin',
      totalGoldtaler: 0,
      completedQuizzes: 0,
      active: true,
      createdAt: new Date().toISOString()
    };
    
    users.push(adminUser);
    console.log('👑 Admin-Benutzer erstellt: admin/admin123');
  }
};

// Login prüfen ob User aktiv ist
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    const user = users.find(u => u.username === username);
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Ungültiger Benutzername oder Passwort' 
      });
    }
    
    // Prüfen ob User aktiv ist
    if (user.active === false) {
      return res.status(403).json({
        success: false,
        message: 'Ihr Account wurde deaktiviert. Kontaktieren Sie den Administrator.'
      });
    }
    
    const isValidPassword = await comparePassword(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ 
        success: false, 
        message: 'Ungültiger Benutzername oder Passwort' 
      });
    }
    
    user.lastLogin = new Date().toISOString();
    
    res.json({ 
      success: true, 
      message: 'Erfolgreich eingeloggt!',
      user: { ...user, password: undefined }
    });
    
  } catch (error) {
    console.error('Login Fehler:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server Fehler beim Login' 
    });
  }
});

// Admin-User beim Start erstellen
createAdminUser();


// Server starten
server.listen(PORT, () => {
  console.log(`🚀 Kooperatives Lern-Quiz System läuft auf Port ${PORT}`);
  console.log(`🌐 Öffnen Sie: http://localhost:${PORT}`);
  console.log(`💬 Chat-System bereit!`);
  console.log(`👑 Admin-Panel verfügbar`);
  console.log(`📚 Fragenkatalog-System aktiv`);
});