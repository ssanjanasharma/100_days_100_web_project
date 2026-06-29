(function() {
  'use strict';

  // Game state (9x9 Grid = 81 cells)
  const state = {
    difficulty: 'easy',
    mode: 'single', // 'single', 'daily', 'multiplayer'
    isPlaying: false,
    isPaused: false,
    board: Array(81).fill(0),
    startBoard: Array(81).fill(0),
    solution: Array(81).fill(0),
    notes: Array.from({ length: 81 }, () => []),
    history: [], // Stack of { board, notes, mistakes }
    historyIndex: -1,
    mistakes: 0,
    maxMistakes: 3,
    mistakeChecking: true,
    activeCellIdx: -1,
    isPencilMode: false,
    elapsedTime: 0,
    timerInterval: null,
    totalNotesPlacedThisGame: 0,
    
    // Multiplayer specific
    botName: 'ScribbleBot',
    botProgress: 0,
    botSolvingInterval: null,
    botSolveTimer: 0,
    botSolveRate: 35, // seconds per cell solved
  };

  // Web Audio Context setup for synthesizers
  let audioCtx = null;

  function initAudio() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
  }

  // Settings
  const settings = {
    soundEnabled: true,
    animationsEnabled: true,
    theme: 'notebook', // 'notebook', 'chalkboard', 'blueprint', 'parchment'
  };

  // Sound Synthesizers using Web Audio API
  const SoundFX = {
    playTone(freq, type, duration, volume = 0.08) {
      if (!settings.soundEnabled) return;
      initAudio();
      try {
        if (audioCtx.state === 'suspended') {
          audioCtx.resume();
        }
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
        
        gain.gain.setValueAtTime(volume, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
        
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        
        osc.start();
        osc.stop(audioCtx.currentTime + duration);
      } catch (e) {
        console.warn("Audio failed to play", e);
      }
    },

    playNoise(duration, volume = 0.03, frequency = 1000, Q = 2.0) {
      if (!settings.soundEnabled) return;
      initAudio();
      try {
        if (audioCtx.state === 'suspended') {
          audioCtx.resume();
        }
        const bufferSize = audioCtx.sampleRate * duration;
        const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          data[i] = Math.random() * 2 - 1;
        }
        
        const noiseNode = audioCtx.createBufferSource();
        noiseNode.buffer = buffer;
        
        const filter = audioCtx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(frequency, audioCtx.currentTime);
        filter.Q.setValueAtTime(Q, audioCtx.currentTime);
        
        const gain = audioCtx.createGain();
        gain.gain.setValueAtTime(volume, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
        
        noiseNode.connect(filter);
        filter.connect(gain);
        gain.connect(audioCtx.destination);
        
        noiseNode.start();
        noiseNode.stop(audioCtx.currentTime + duration);
      } catch (e) {
        console.warn("Audio noise failed to play", e);
      }
    },

    playClick() {
      this.playTone(600, 'sine', 0.05, 0.05);
    },

    playPencil() {
      this.playNoise(0.08, 0.04, 1200, 3.0);
    },

    playErase() {
      this.playNoise(0.15, 0.05, 500, 1.0);
    },

    playPageFlip() {
      this.playNoise(0.25, 0.03, 300, 0.5);
    },

    playError() {
      this.playTone(180, 'sawtooth', 0.2, 0.08);
      setTimeout(() => this.playTone(150, 'sawtooth', 0.25, 0.08), 80);
    },

    playWinChime() {
      const notes = [261.63, 329.63, 392.00, 523.25, 659.25, 783.99, 1046.50]; // C Major
      notes.forEach((freq, idx) => {
        setTimeout(() => {
          this.playTone(freq, 'triangle', 0.6, 0.06);
        }, idx * 100);
      });
    }
  };

  // Achievements
  const ACHIEVEMENTS = [
    { id: 'first_step', title: 'First Scribble', desc: 'Place a correct number on the board', icon: '📝' },
    { id: 'perfect_paper', title: 'Perfect Sheet', desc: 'Solve a puzzle with 0 mistakes', icon: '✨' },
    { id: 'speed_demon', title: 'Speed Demon', desc: 'Solve a puzzle in under 5 minutes', icon: '⚡' },
    { id: 'pencil_pusher', title: 'Pencil Pusher', desc: 'Add 15 note markings in one game', icon: '✏️' },
    { id: 'expert_draftsman', title: 'Expert Draftsman', desc: 'Complete a puzzle on Expert difficulty', icon: '🎓' },
    { id: 'daily_scribbler', title: 'Daily Challenge', desc: 'Complete a Daily Challenge puzzle', icon: '📅' },
    { id: 'streak_star', title: 'Streak Star', desc: 'Win 3 games in a row', icon: '🌟' },
    { id: 'bot_crusher', title: 'Bot Crusher', desc: 'Win a Multiplayer Race against the AI', icon: '🤖' }
  ];

  // DOM Elements
  let el = {};

  function cacheElements() {
    el = {
      grid: document.getElementById('sudoku-grid'),
      timer: document.getElementById('game-timer'),
      bestTime: document.getElementById('best-time'),
      mistakes: document.getElementById('mistakes-count'),
      maxMistakes: document.getElementById('max-mistakes'),
      difficultySelect: document.getElementById('difficulty-select'),
      difficultyDisplay: document.getElementById('difficulty-display'),
      pencilBtn: document.getElementById('pencil-btn'),
      eraserBtn: document.getElementById('eraser-btn'),
      hintBtn: document.getElementById('hint-btn'),
      checkBtn: document.getElementById('check-btn'),
      undoBtn: document.getElementById('undo-btn'),
      redoBtn: document.getElementById('redo-btn'),
      pauseBtn: document.getElementById('pause-btn'),
      restartBtn: document.getElementById('restart-btn'),
      newGameBtn: document.getElementById('new-game-btn'),
      mistakeToggle: document.getElementById('mistake-checking-toggle'),
      themeSelect: document.getElementById('theme-select'),
      soundToggle: document.getElementById('sound-toggle'),
      animToggle: document.getElementById('anim-toggle'),
      keypad: document.getElementById('keypad'),
      
      // Drawers & Modals
      statsBtn: document.getElementById('stats-btn'),
      leaderboardBtn: document.getElementById('leaderboard-btn'),
      achievementsBtn: document.getElementById('achievements-btn'),
      rulesBtn: document.getElementById('rules-btn'),
      importExportBtn: document.getElementById('import-export-btn'),
      
      modalOverlay: document.getElementById('modal-overlay'),
      modalTitle: document.getElementById('modal-title'),
      modalBody: document.getElementById('modal-body'),
      modalClose: document.getElementById('modal-close'),
      
      // Multiplayer widgets
      multiplayerRacePanel: document.getElementById('multiplayer-race-panel'),
      botNameDisplay: document.getElementById('bot-name'),
      botProgressBar: document.getElementById('bot-progress-bar'),
      botPercent: document.getElementById('bot-percent'),
      playerProgressBar: document.getElementById('player-progress-bar'),
      playerPercent: document.getElementById('player-percent'),
      
      // Mode tabs
      modeSingle: document.getElementById('mode-single-btn'),
      modeDaily: document.getElementById('mode-daily-btn'),
      modeMulti: document.getElementById('mode-multi-btn'),

      // Celebration
      celebrationOverlay: document.getElementById('celebration-overlay'),
      celebrationMessage: document.getElementById('celebration-message'),
      celebrationClose: document.getElementById('celebration-close'),
      celebrationCanvas: document.getElementById('celebration-canvas'),
      
      // Resume banner
      resumeBanner: document.getElementById('resume-banner'),
      resumeBtn: document.getElementById('resume-btn'),
      discardBtn: document.getElementById('discard-btn'),
    };
  }

  // Load / Initialize Settings & State
  function loadSettings() {
    const saved = localStorage.getItem('sudoku_settings_v2');
    if (saved) {
      Object.assign(settings, JSON.parse(saved));
    }
    document.body.className = `theme-${settings.theme}`;
    if (el.themeSelect) el.themeSelect.value = settings.theme;
    if (el.soundToggle) el.soundToggle.checked = settings.soundEnabled;
    if (el.animToggle) el.animToggle.checked = settings.animationsEnabled;
  }

  function saveSettings() {
    localStorage.setItem('sudoku_settings_v2', JSON.stringify(settings));
    document.body.className = `theme-${settings.theme}`;
  }

  // Initialize page bindings
  window.addEventListener('DOMContentLoaded', () => {
    cacheElements();
    loadSettings();
    initGrid();
    setupEventHandlers();
    checkAutosave();
    updateStatsDashboard();
    updateLeaderboardView();
    updateAchievementsView();
    
    // Start game
    startNewGame();
  });

  // Render blank Grid cells for 9x9
  function initGrid() {
    el.grid.innerHTML = '';
    for (let i = 0; i < 81; i++) {
      const cell = document.createElement('div');
      cell.classList.add('sudoku-cell');
      cell.dataset.index = i;

      // Draw subgrid boundaries for 9x9 (3x3 subgrids)
      const r = Math.floor(i / 9);
      const c = i % 9;
      if (r === 2 || r === 5) cell.classList.add('border-bottom-thick');
      if (c === 2 || c === 5) cell.classList.add('border-right-thick');

      // Notes subgrid structure (9 slots)
      const notesGrid = document.createElement('div');
      notesGrid.classList.add('notes-grid');
      notesGrid.style.gridTemplateColumns = 'repeat(3, 1fr)';
      notesGrid.style.gridTemplateRows = 'repeat(3, 1fr)';
      
      for (let n = 1; n <= 9; n++) {
        const noteVal = document.createElement('span');
        noteVal.classList.add('note-value');
        noteVal.dataset.note = n;
        notesGrid.appendChild(noteVal);
      }
      
      const valueSpan = document.createElement('span');
      valueSpan.classList.add('cell-value');

      cell.appendChild(notesGrid);
      cell.appendChild(valueSpan);
      el.grid.appendChild(cell);
    }
  }

  // Event handler setups
  function setupEventHandlers() {
    // Grid cell clicks
    el.grid.addEventListener('click', (e) => {
      const cell = e.target.closest('.sudoku-cell');
      if (!cell || !state.isPlaying || state.isPaused) return;

      SoundFX.playClick();
      selectCell(parseInt(cell.dataset.index));
    });

    // Keypad numbers
    el.keypad.addEventListener('click', (e) => {
      const btn = e.target.closest('.keypad-btn');
      if (!btn || !state.isPlaying || state.isPaused) return;

      const action = btn.dataset.action;
      const num = parseInt(btn.dataset.number);

      if (num && num <= 9) {
        handleNumberInput(num);
      } else if (action === 'erase') {
        eraseActiveCell();
      } else if (action === 'pencil') {
        togglePencilMode();
      } else if (action === 'hint') {
        triggerAIHint();
      }
    });

    // Game Control Buttons
    el.newGameBtn.addEventListener('click', () => { SoundFX.playPageFlip(); startNewGame(); });
    el.restartBtn.addEventListener('click', () => { SoundFX.playPageFlip(); restartPuzzle(); });
    el.pauseBtn.addEventListener('click', togglePause);
    el.undoBtn.addEventListener('click', undoMove);
    el.redoBtn.addEventListener('click', redoMove);
    el.hintBtn.addEventListener('click', triggerAIHint);
    el.eraserBtn.addEventListener('click', eraseActiveCell);
    el.pencilBtn.addEventListener('click', togglePencilMode);
    
    el.checkBtn.addEventListener('click', checkCurrentSolution);

    // Difficulty dropdown
    el.difficultySelect.addEventListener('change', (e) => {
      state.difficulty = e.target.value;
      if (state.mode === 'single' || state.mode === 'multiplayer') {
        SoundFX.playPageFlip();
        startNewGame();
      }
    });

    // Settings adjustments
    el.themeSelect.addEventListener('change', (e) => {
      settings.theme = e.target.value;
      saveSettings();
      SoundFX.playPageFlip();
    });
    
    el.soundToggle.addEventListener('change', (e) => {
      settings.soundEnabled = e.target.checked;
      saveSettings();
    });

    el.animToggle.addEventListener('change', (e) => {
      settings.animationsEnabled = e.target.checked;
      saveSettings();
    });

    el.mistakeToggle.addEventListener('change', (e) => {
      state.mistakeChecking = e.target.checked;
      saveAutosave();
      renderBoard();
    });

    // Keyboard Shortcuts
    document.addEventListener('keydown', handleKeyboardShortcuts);

    // Drawers / Panels
    el.statsBtn.addEventListener('click', showStatsDrawer);
    el.leaderboardBtn.addEventListener('click', showLeaderboardDrawer);
    el.achievementsBtn.addEventListener('click', showAchievementsDrawer);
    el.rulesBtn.addEventListener('click', showRulesDrawer);
    el.importExportBtn.addEventListener('click', showImportExportDrawer);
    el.modalClose.addEventListener('click', closeModal);
    el.modalOverlay.addEventListener('click', (e) => {
      if (e.target === el.modalOverlay) closeModal();
    });

    // Mode switching
    el.modeSingle.addEventListener('click', () => switchMode('single'));
    el.modeDaily.addEventListener('click', () => switchMode('daily'));
    el.modeMulti.addEventListener('click', () => switchMode('multiplayer'));

    // Resume/Discard autosave
    el.resumeBtn.addEventListener('click', resumeAutosavedGame);
    el.discardBtn.addEventListener('click', discardAutosavedGame);

    // Celebration close
    el.celebrationClose.addEventListener('click', () => {
      el.celebrationOverlay.classList.remove('active');
    });
  }

  // Switch Game Mode
  function switchMode(newMode) {
    if (state.mode === newMode) return;
    SoundFX.playPageFlip();
    
    el.modeSingle.classList.toggle('active', newMode === 'single');
    el.modeDaily.classList.toggle('active', newMode === 'daily');
    el.modeMulti.classList.toggle('active', newMode === 'multiplayer');

    state.mode = newMode;
    
    if (newMode === 'daily') {
      el.difficultySelect.disabled = true;
      setupDailyChallenge();
    } else if (newMode === 'multiplayer') {
      el.difficultySelect.disabled = false;
      el.multiplayerRacePanel.style.display = 'block';
      startNewGame();
    } else {
      el.difficultySelect.disabled = false;
      el.multiplayerRacePanel.style.display = 'none';
      startNewGame();
    }
  }

  // Setup Daily Challenge Puzzle for 9x9
  function setupDailyChallenge() {
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0];
    
    el.difficultyDisplay.textContent = `Daily Challenge (${dateStr})`;
    
    const day = today.getDay();
    let diff = 'medium';
    if (day === 0 || day === 6) diff = 'expert';
    else if (day === 3 || day === 5) diff = 'hard';
    else diff = 'easy';

    const puzzleData = window.SudokuEngine.generatePuzzle(diff, dateStr);
    
    state.difficulty = diff;
    state.board = [...puzzleData.puzzle];
    state.startBoard = [...puzzleData.puzzle];
    state.solution = [...puzzleData.solution];
    state.notes = Array.from({ length: 81 }, () => []);
    state.activeCellIdx = -1;
    state.mistakes = 0;
    state.elapsedTime = 0;
    state.totalNotesPlacedThisGame = 0;
    
    state.history = [];
    state.historyIndex = -1;
    pushHistory();

    state.isPlaying = true;
    state.isPaused = false;
    
    el.multiplayerRacePanel.style.display = 'none';
    
    renderBoard();
    updateBestTimeDisplay();
    startTimer();
  }

  // Start New Game
  function startNewGame() {
    clearInterval(state.botSolvingInterval);
    
    const diff = state.difficulty;
    el.difficultyDisplay.textContent = diff.toUpperCase();
    
    const seed = Math.floor(Math.random() * 10000000);
    const puzzleData = window.SudokuEngine.generatePuzzle(diff, seed);

    state.board = [...puzzleData.puzzle];
    state.startBoard = [...puzzleData.puzzle];
    state.solution = [...puzzleData.solution];
    state.notes = Array.from({ length: 81 }, () => []);
    state.activeCellIdx = -1;
    state.mistakes = 0;
    state.elapsedTime = 0;
    state.totalNotesPlacedThisGame = 0;

    state.history = [];
    state.historyIndex = -1;
    pushHistory();

    state.isPlaying = true;
    state.isPaused = false;

    if (state.mode === 'multiplayer') {
      setupMultiplayerBot();
    }

    renderBoard();
    updateBestTimeDisplay();
    startTimer();
    saveAutosave();
  }

  // Restart Puzzle
  function restartPuzzle() {
    state.board = [...state.startBoard];
    state.notes = Array.from({ length: 81 }, () => []);
    state.activeCellIdx = -1;
    state.mistakes = 0;
    state.elapsedTime = 0;

    state.history = [];
    state.historyIndex = -1;
    pushHistory();

    state.isPlaying = true;
    state.isPaused = false;

    if (state.mode === 'multiplayer') {
      setupMultiplayerBot();
    }

    renderBoard();
    startTimer();
    saveAutosave();
  }

  // Setup multiplayer Bot for 9x9
  function setupMultiplayerBot() {
    const bots = [
      { name: 'ScribbleBot', rate: 40 },
      { name: 'PencilExpert', rate: 26 },
      { name: 'InkMaster', rate: 16 }
    ];
    let botIndex = 0;
    if (state.difficulty === 'medium') botIndex = 0;
    else if (state.difficulty === 'hard') botIndex = 1;
    else if (state.difficulty === 'expert') botIndex = 2;

    const selectedBot = bots[botIndex];
    state.botName = selectedBot.name;
    state.botSolveRate = selectedBot.rate;
    
    const initialClues = state.startBoard.filter(val => val !== 0).length;
    state.botProgress = initialClues;
    state.botSolveTimer = 0;

    el.botNameDisplay.textContent = state.botName;
    updateMultiplayerProgressUI();

    clearInterval(state.botSolvingInterval);
    state.botSolvingInterval = setInterval(() => {
      if (!state.isPlaying || state.isPaused) return;

      state.botSolveTimer++;
      const variance = Math.sin(state.botSolveTimer * 0.1) * 3; 
      const currentRate = Math.max(5, state.botSolveRate + variance);

      if (state.botSolveTimer >= currentRate) {
        state.botSolveTimer = 0;
        state.botProgress++;
        updateMultiplayerProgressUI();
        
        if (state.botProgress >= 81) {
          triggerGameLostByBot();
        }
      }
    }, 1000);
  }

  // Update multiplayer progress bars
  function updateMultiplayerProgressUI() {
    const initialClues = state.startBoard.filter(val => val !== 0).length;
    const totalToSolve = 81 - initialClues;

    const botSolved = Math.max(0, state.botProgress - initialClues);
    const botPercentage = totalToSolve > 0 ? Math.round((botSolved / totalToSolve) * 100) : 0;
    el.botProgressBar.style.width = `${botPercentage}%`;
    el.botPercent.textContent = `${botPercentage}% (${botSolved}/${totalToSolve})`;

    let playerCorrect = 0;
    for (let i = 0; i < 81; i++) {
      if (state.startBoard[i] === 0 && state.board[i] === state.solution[i]) {
        playerCorrect++;
      }
    }
    const playerPercentage = totalToSolve > 0 ? Math.round((playerCorrect / totalToSolve) * 100) : 0;
    el.playerProgressBar.style.width = `${playerPercentage}%`;
    el.playerPercent.textContent = `${playerPercentage}% (${playerCorrect}/${totalToSolve})`;
  }

  function triggerGameLostByBot() {
    clearInterval(state.botSolvingInterval);
    state.isPlaying = false;
    stopTimer();
    clearAutosave();
    SoundFX.playError();

    el.celebrationMessage.innerHTML = `
      <h2 style="font-family: 'Nanum Pen Script', cursive; font-size: 2.5rem; margin-bottom: 10px;">Race Finished!</h2>
      <p style="font-size: 1.3em; line-height: 1.5;">Oh no! 🤖 <strong>${state.botName}</strong> completed the puzzle first!</p>
      <p>Try again to defeat the bot!</p>
    `;
    el.celebrationOverlay.classList.add('active');
    recordGameResult(false);
  }

  // Cell Selection
  function selectCell(idx) {
    state.activeCellIdx = idx;
    renderBoard();
  }

  // Render current board state to DOM
  function renderBoard() {
    const activeVal = state.activeCellIdx !== -1 ? state.board[state.activeCellIdx] : 0;
    const activeRow = state.activeCellIdx !== -1 ? Math.floor(state.activeCellIdx / 9) : -1;
    const activeCol = state.activeCellIdx !== -1 ? state.activeCellIdx % 9 : -1;
    const activeBox = state.activeCellIdx !== -1 ? window.SudokuEngine.getBox(state.activeCellIdx) : -1;

    const numberCounts = Array(10).fill(0); // 1-9 counts

    const cells = el.grid.querySelectorAll('.sudoku-cell');
    cells.forEach((cell, i) => {
      const val = state.board[i];
      const valSpan = cell.querySelector('.cell-value');
      const notesGrid = cell.querySelector('.notes-grid');

      // Reset styles
      cell.className = 'sudoku-cell';
      const r = Math.floor(i / 9);
      const c = i % 9;
      if (r === 2 || r === 5) cell.classList.add('border-bottom-thick');
      if (c === 2 || c === 5) cell.classList.add('border-right-thick');

      // Highlight active cell and its peers
      if (i === state.activeCellIdx) {
        cell.classList.add('selected');
      } else if (activeRow !== -1) {
        const cellBox = window.SudokuEngine.getBox(i);
        if (r === activeRow || c === activeCol || cellBox === activeBox) {
          cell.classList.add('highlight-peer');
        }
      }

      // Prefilled cells
      if (state.startBoard[i] !== 0) {
        cell.classList.add('prefilled');
        valSpan.textContent = val;
        notesGrid.style.display = 'none';
        numberCounts[val]++;
      } 
      // User placed values
      else if (val !== 0) {
        valSpan.textContent = val;
        notesGrid.style.display = 'none';
        numberCounts[val]++;

        if (state.mistakeChecking && val !== state.solution[i]) {
          cell.classList.add('incorrect');
        } else {
          cell.classList.add('correct');
        }
      } 
      // Empty cell - show pencil notes
      else {
        valSpan.textContent = '';
        notesGrid.style.display = 'grid';
        
        const noteSpans = notesGrid.querySelectorAll('.note-value');
        noteSpans.forEach(ns => {
          const noteVal = parseInt(ns.dataset.note);
          if (state.notes[i].includes(noteVal)) {
            ns.textContent = noteVal;
          } else {
            ns.textContent = '';
          }
        });
      }

      // Matching numbers
      if (activeVal !== 0 && val === activeVal) {
        cell.classList.add('highlight-match');
      }
    });

    el.mistakes.textContent = state.mistakes;
    el.maxMistakes.textContent = state.maxMistakes;

    updateNumberKeypadUI(numberCounts);

    el.undoBtn.disabled = state.historyIndex <= 0;
    el.redoBtn.disabled = state.historyIndex >= state.history.length - 1;

    if (state.mode === 'multiplayer') {
      updateMultiplayerProgressUI();
    }
  }

  // keypad numbers count styling
  function updateNumberKeypadUI(counts) {
    for (let num = 1; num <= 9; num++) {
      const btn = document.querySelector(`.keypad-btn[data-number="${num}"]`);
      if (!btn) continue;

      const count = counts[num];
      
      let countBadge = btn.querySelector('.num-count');
      if (!countBadge) {
        countBadge = document.createElement('span');
        countBadge.classList.add('num-count');
        btn.appendChild(countBadge);
      }
      countBadge.textContent = `${count}/9`;

      if (count >= 9) {
        btn.classList.add('completed');
      } else {
        btn.classList.remove('completed');
      }
    }
  }

  // Handle number input (1-9)
  function handleNumberInput(num) {
    if (state.activeCellIdx === -1) return;
    if (state.startBoard[state.activeCellIdx] !== 0) return;

    if (state.isPencilMode) {
      SoundFX.playPencil();
      const cellNotes = state.notes[state.activeCellIdx];
      const idx = cellNotes.indexOf(num);
      if (idx === -1) {
        cellNotes.push(num);
        state.totalNotesPlacedThisGame++;
        if (state.totalNotesPlacedThisGame >= 15) {
          unlockAchievement('pencil_pusher');
        }
      } else {
        cellNotes.splice(idx, 1);
      }
      state.board[state.activeCellIdx] = 0;
    } else {
      SoundFX.playPencil();
      const oldVal = state.board[state.activeCellIdx];
      if (oldVal === num) return;

      state.board[state.activeCellIdx] = num;
      state.notes[state.activeCellIdx] = [];

      if (state.mistakeChecking) {
        if (num !== state.solution[state.activeCellIdx]) {
          state.mistakes++;
          SoundFX.playError();
          
          if (state.mistakes >= state.maxMistakes) {
            triggerGameOver();
            return;
          }
        } else {
          unlockAchievement('first_step');
          autoClearPeerNotes(state.activeCellIdx, num);
        }
      } else {
        unlockAchievement('first_step');
      }
    }

    pushHistory();
    renderBoard();
    checkWinCondition();
    saveAutosave();
  }

  function autoClearPeerNotes(idx, num) {
    const peers = window.SudokuEngine.getPeers(idx);
    peers.forEach(peerIdx => {
      const noteArr = state.notes[peerIdx];
      const pos = noteArr.indexOf(num);
      if (pos !== -1) {
        noteArr.splice(pos, 1);
      }
    });
  }

  function eraseActiveCell() {
    if (state.activeCellIdx === -1) return;
    if (state.startBoard[state.activeCellIdx] !== 0) return;

    SoundFX.playErase();
    state.board[state.activeCellIdx] = 0;
    state.notes[state.activeCellIdx] = [];
    
    pushHistory();
    renderBoard();
    saveAutosave();
  }

  function togglePencilMode() {
    state.isPencilMode = !state.isPencilMode;
    el.pencilBtn.classList.toggle('active', state.isPencilMode);
    SoundFX.playClick();
  }

  function pushHistory() {
    state.history = state.history.slice(0, state.historyIndex + 1);
    state.history.push({
      board: [...state.board],
      notes: state.notes.map(arr => [...arr]),
      mistakes: state.mistakes
    });
    state.historyIndex++;
  }

  function undoMove() {
    if (state.historyIndex <= 0) return;
    SoundFX.playPageFlip();
    state.historyIndex--;
    const snapshot = state.history[state.historyIndex];
    state.board = [...snapshot.board];
    state.notes = snapshot.notes.map(arr => [...arr]);
    state.mistakes = snapshot.mistakes;
    renderBoard();
    saveAutosave();
  }

  function redoMove() {
    if (state.historyIndex >= state.history.length - 1) return;
    SoundFX.playPageFlip();
    state.historyIndex++;
    const snapshot = state.history[state.historyIndex];
    state.board = [...snapshot.board];
    state.notes = snapshot.notes.map(arr => [...arr]);
    state.mistakes = snapshot.mistakes;
    renderBoard();
    saveAutosave();
  }

  // Timer
  function startTimer() {
    stopTimer();
    state.timerInterval = setInterval(() => {
      if (!state.isPaused && state.isPlaying) {
        state.elapsedTime++;
        updateTimerDisplay();
      }
    }, 1000);
  }

  function stopTimer() {
    clearInterval(state.timerInterval);
  }

  function togglePause() {
    if (!state.isPlaying) return;
    state.isPaused = !state.isPaused;
    SoundFX.playPageFlip();
    
    if (state.isPaused) {
      el.pauseBtn.innerHTML = '<span class="icon">▶</span> Resume';
      el.grid.classList.add('paused');
      el.keypad.classList.add('disabled');
    } else {
      el.pauseBtn.innerHTML = '<span class="icon">⏸</span> Pause';
      el.grid.classList.remove('paused');
      el.keypad.classList.remove('disabled');
    }
  }

  function updateTimerDisplay() {
    const mins = Math.floor(state.elapsedTime / 60);
    const secs = state.elapsedTime % 60;
    el.timer.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  function updateBestTimeDisplay() {
    const records = getLeaderboard();
    const diffRecords = records[state.difficulty] || [];
    if (diffRecords.length > 0) {
      const best = diffRecords[0].time;
      const mins = Math.floor(best / 60);
      const secs = best % 60;
      el.bestTime.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    } else {
      el.bestTime.textContent = '--:--';
    }
  }

  // AI Hint System
  function triggerAIHint() {
    if (state.activeCellIdx === -1) {
      const emptyIdx = state.board.indexOf(0);
      if (emptyIdx !== -1) {
        state.activeCellIdx = emptyIdx;
      } else {
        alert("The board is already filled.");
        return;
      }
    }

    const hint = window.SudokuEngine.getAIHint(state.board, state.solution);
    if (!hint || hint.type === 'solved') {
      alert("No cells need hints!");
      return;
    }

    SoundFX.playPageFlip();
    el.modalTitle.textContent = "AI Sketch Hint";
    el.modalBody.innerHTML = `
      <div class="hint-detail">
        <p>${hint.explanation}</p>
        <div style="margin-top: 20px; text-align: center;">
          <button id="modal-fill-hint-btn" class="paper-btn active-btn" style="padding: 10px 20px;">✍️ Write Correct Value (${hint.val})</button>
        </div>
      </div>
    `;
    el.modalOverlay.style.display = 'flex';

    const modalFillBtn = document.getElementById('modal-fill-hint-btn');
    if (modalFillBtn) {
      modalFillBtn.addEventListener('click', () => {
        closeModal();
        state.activeCellIdx = hint.idx;
        handleNumberInput(hint.val);
      });
    }
  }

  // Check Solution
  function checkCurrentSolution() {
    SoundFX.playPageFlip();
    let correctCount = 0;
    let incorrectCount = 0;
    let emptyCount = 0;

    for (let i = 0; i < 81; i++) {
      if (state.board[i] === 0) {
        emptyCount++;
      } else if (state.board[i] === state.solution[i]) {
        correctCount++;
      } else {
        incorrectCount++;
      }
    }

    el.modalTitle.textContent = "Board Validation Sketch";
    el.modalBody.innerHTML = `
      <div style="text-align: center; font-family: 'Nanum Pen Script', cursive; font-size: 1.4rem;">
        <p style="font-size: 1.5rem; font-weight:bold;">📋 Grid Summary:</p>
        <ul style="list-style-type: none; padding: 0; line-height: 1.8; font-size: 1.3rem;">
          <li>🟢 Correct placements: <strong>${correctCount}</strong></li>
          <li>🔴 Incorrect entries: <strong>${incorrectCount}</strong></li>
          <li>⚪ Remaining blanks: <strong>${emptyCount}</strong></li>
        </ul>
        ${incorrectCount > 0 ? '<p style="color: var(--incorrect-color); margin-top: 15px;">🔍 Tip: Enable "Mistake Checking" to catch errors as you write!</p>' : '<p style="color: var(--correct-color); margin-top: 15px;">🎉 Doing great! No errors detected so far.</p>'}
      </div>
    `;
    el.modalOverlay.style.display = 'flex';
  }

  // Autosave using LocalStorage
  function checkAutosave() {
    const saved = localStorage.getItem('sudoku_autosave_v2');
    if (saved) {
      el.resumeBanner.style.display = 'flex';
    }
  }

  // Resume saved game
  function resumeAutosavedGame() {
    const saved = localStorage.getItem('sudoku_autosave_v2');
    if (!saved) return;

    SoundFX.playPageFlip();
    const data = JSON.parse(saved);
    
    state.difficulty = data.difficulty;
    state.mode = data.mode || 'single';
    state.board = data.board;
    state.startBoard = data.startBoard;
    state.solution = data.solution;
    state.notes = data.notes.map(arr => [...arr]);
    state.mistakes = data.mistakes;
    state.elapsedTime = data.elapsedTime;
    state.totalNotesPlacedThisGame = data.totalNotesPlacedThisGame || 0;
    state.isPlaying = true;
    state.isPaused = false;
    
    el.difficultySelect.value = state.difficulty;
    el.difficultyDisplay.textContent = state.difficulty.toUpperCase();

    switchMode(state.mode);

    state.history = data.history || [{ board: [...state.board], notes: state.notes.map(arr => [...arr]), mistakes: state.mistakes }];
    state.historyIndex = data.historyIndex || 0;

    el.resumeBanner.style.display = 'none';

    renderBoard();
    updateBestTimeDisplay();
    startTimer();
  }

  function discardAutosavedGame() {
    SoundFX.playErase();
    clearAutosave();
    el.resumeBanner.style.display = 'none';
  }

  function saveAutosave() {
    if (!state.isPlaying) return;
    const data = {
      difficulty: state.difficulty,
      mode: state.mode,
      board: state.board,
      startBoard: state.startBoard,
      solution: state.solution,
      notes: state.notes,
      mistakes: state.mistakes,
      elapsedTime: state.elapsedTime,
      totalNotesPlacedThisGame: state.totalNotesPlacedThisGame,
      history: state.history,
      historyIndex: state.historyIndex
    };
    localStorage.setItem('sudoku_autosave_v2', JSON.stringify(data));
  }

  function clearAutosave() {
    localStorage.removeItem('sudoku_autosave_v2');
  }

  // Win Detection
  function checkWinCondition() {
    for (let i = 0; i < 81; i++) {
      if (state.board[i] !== state.solution[i]) {
        return;
      }
    }
    triggerGameWin();
  }

  function triggerGameWin() {
    clearInterval(state.botSolvingInterval);
    state.isPlaying = false;
    stopTimer();
    clearAutosave();
    SoundFX.playWinChime();

    recordGameResult(true);
    saveLeaderboardRecord();

    if (state.mistakes === 0) unlockAchievement('perfect_paper');
    if (state.elapsedTime < 300) unlockAchievement('speed_demon'); // 5 mins
    if (state.difficulty === 'expert') unlockAchievement('expert_draftsman');
    if (state.mode === 'daily') unlockAchievement('daily_scribbler');
    if (state.mode === 'multiplayer') unlockAchievement('bot_crusher');

    setTimeout(startSketchConfetti, 300);

    const mins = Math.floor(state.elapsedTime / 60);
    const secs = state.elapsedTime % 60;
    const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;

    el.celebrationMessage.innerHTML = `
      <h2 style="font-family: 'Nanum Pen Script', cursive; font-size: 2.6rem; margin-bottom: 10px;">Puzzle Complete! 🎉</h2>
      <p style="font-size: 1.3em; line-height: 1.5;">Wonderful drafting! You solved the Sudoku in <strong>${timeStr}</strong> on <strong>${state.difficulty}</strong> mode!</p>
      <p>Mistakes made: <strong>${state.mistakes} / ${state.maxMistakes}</strong></p>
      <div style="margin-top: 20px;">
        <button id="share-score-btn" class="paper-btn active-btn" style="padding: 8px 16px;">🔗 Share Completed Record</button>
      </div>
    `;
    el.celebrationOverlay.classList.add('active');

    document.getElementById('share-score-btn').addEventListener('click', () => {
      const shareText = `✍️ I just solved a 9x9 ${state.difficulty} Sudoku Puzzle on SketchSudoku in ${timeStr} with ${state.mistakes} mistakes! Can you beat my draft? 📓`;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(shareText).then(() => {
          alert("Score snippet copied to clipboard!");
        });
      } else {
        alert(shareText);
      }
    });

    updateStatsDashboard();
    updateLeaderboardView();
  }

  function triggerGameOver() {
    clearInterval(state.botSolvingInterval);
    state.isPlaying = false;
    stopTimer();
    clearAutosave();
    SoundFX.playError();
    recordGameResult(false);

    el.celebrationMessage.innerHTML = `
      <h2 style="font-family: 'Nanum Pen Script', cursive; font-size: 2.6rem; margin-bottom: 10px; color: var(--incorrect-color);">Sheet Shredded! 😢</h2>
      <p style="font-size: 1.3em;">You've reached the limit of <strong>${state.maxMistakes}</strong> mistakes.</p>
      <p>Don't throw away the clipboard yet! Start a new sketch and try again.</p>
    `;
    el.celebrationOverlay.classList.add('active');
    updateStatsDashboard();
  }

  // Leaderboard Records
  function getLeaderboard() {
    const raw = localStorage.getItem('sudoku_leaderboard_v2');
    return raw ? JSON.parse(raw) : { easy: [], medium: [], hard: [], expert: [] };
  }

  function saveLeaderboardRecord() {
    const records = getLeaderboard();
    const diff = state.difficulty;
    const today = new Date().toLocaleDateString();
    
    const record = {
      time: state.elapsedTime,
      date: today,
      mistakes: state.mistakes
    };

    records[diff].push(record);
    records[diff].sort((a, b) => a.time - b.time);
    records[diff] = records[diff].slice(0, 5);

    localStorage.setItem('sudoku_leaderboard_v2', JSON.stringify(records));
  }

  // Statistics
  function getStats() {
    const raw = localStorage.getItem('sudoku_stats_v2');
    return raw ? JSON.parse(raw) : {
      gamesPlayed: 0,
      gamesWon: 0,
      streaks: { current: 0, longest: 0 },
      times: { total: 0, count: 0, fastest: null }
    };
  }

  function recordGameResult(won) {
    const stats = getStats();
    stats.gamesPlayed++;
    
    if (won) {
      stats.gamesWon++;
      stats.streaks.current++;
      if (stats.streaks.current > stats.streaks.longest) {
        stats.streaks.longest = stats.streaks.current;
      }
      if (stats.streaks.current >= 3) {
        unlockAchievement('streak_star');
      }

      stats.times.total += state.elapsedTime;
      stats.times.count++;
      if (!stats.times.fastest || state.elapsedTime < stats.times.fastest) {
        stats.times.fastest = state.elapsedTime;
      }
    } else {
      stats.streaks.current = 0;
    }

    localStorage.setItem('sudoku_stats_v2', JSON.stringify(stats));
  }

  // Achievements
  function getUnlockedAchievements() {
    const raw = localStorage.getItem('sudoku_achievements_v2');
    return raw ? JSON.parse(raw) : [];
  }

  function unlockAchievement(id) {
    const unlocked = getUnlockedAchievements();
    if (unlocked.includes(id)) return;

    unlocked.push(id);
    localStorage.setItem('sudoku_achievements_v2', JSON.stringify(unlocked));
    
    const ach = ACHIEVEMENTS.find(a => a.id === id);
    if (ach) {
      showAchievementToast(ach);
    }
    updateAchievementsView();
  }

  function showAchievementToast(ach) {
    const toast = document.createElement('div');
    toast.className = 'achievement-toast handdrawn-box';
    toast.style.fontFamily = "'Nanum Pen Script', cursive";
    toast.style.fontSize = "1.3rem";
    toast.innerHTML = `
      <div class="toast-icon">${ach.icon}</div>
      <div class="toast-content">
        <div class="toast-title" style="font-weight:bold; font-size:1.4rem;">Achievement Unlocked!</div>
        <div class="toast-desc">${ach.title} - ${ach.desc}</div>
      </div>
    `;
    document.body.appendChild(toast);
    
    setTimeout(() => {
      toast.classList.add('visible');
    }, 100);

    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => toast.remove(), 500);
    }, 4000);
  }

  function openModal(title, contentHTML) {
    el.modalTitle.textContent = title;
    el.modalBody.innerHTML = contentHTML;
    el.modalOverlay.style.display = 'flex';
    SoundFX.playPageFlip();
  }

  function closeModal() {
    el.modalOverlay.style.display = 'none';
    SoundFX.playPageFlip();
  }

  // Drawers
  function showStatsDrawer() {
    updateStatsDashboard();
    const stats = getStats();
    const winRate = stats.gamesPlayed > 0 ? Math.round((stats.gamesWon / stats.gamesPlayed) * 100) : 0;
    const avgTimeSec = stats.times.count > 0 ? Math.round(stats.times.total / stats.times.count) : 0;
    
    const formatTime = (sec) => {
      if (!sec) return '--:--';
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      return `${m}m ${s}s`;
    };

    const numberCounts = Array(10).fill(0);
    state.board.forEach(v => { if (v !== 0) numberCounts[v]++; });

    let heatmapHTML = `<div class="heatmap-container" style="margin-top:20px;">
      <h3 style="font-family:'Nanum Pen Script'; font-size:1.6rem; text-align:center;">✏️ Number Heatmap (Placed Clues)</h3>
      <div class="heatmap-chart" style="display:flex; justify-content:space-around; align-items:flex-end; height:120px; border-bottom:2px solid var(--ink-color); padding-bottom:5px; margin-top:10px;">
    `;
    for (let num = 1; num <= 9; num++) {
      const pct = Math.round((numberCounts[num] / 9) * 100);
      heatmapHTML += `
        <div class="heatmap-bar-wrapper" style="display:flex; flex-direction:column; align-items:center; width:8%;">
          <span style="font-size:0.95rem; margin-bottom:2px;">${numberCounts[num]}/9</span>
          <div class="heatmap-bar" style="width:100%; height:${Math.max(6, pct)}%; background:var(--ink-color); opacity:${0.3 + (pct/180)}; border-radius:3px 3px 0 0; min-height: 5px;"></div>
          <span style="font-weight:bold; margin-top:5px; font-size:1.2rem;">${num}</span>
        </div>
      `;
    }
    heatmapHTML += `</div></div>`;

    const bodyHTML = `
      <div style="font-family: 'Nanum Pen Script', cursive; line-height: 1.6; font-size: 1.4rem;">
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; text-align: center;">
          <div class="stat-card" style="border:1.5px dashed var(--ink-color); padding: 8px; border-radius:5px;">
            <p style="margin: 0; font-size: 1.1em; opacity: 0.7;">Games Played</p>
            <h3 style="margin: 5px 0 0 0; font-size: 1.8em;">${stats.gamesPlayed}</h3>
          </div>
          <div class="stat-card" style="border:1.5px dashed var(--ink-color); padding: 8px; border-radius:5px;">
            <p style="margin: 0; font-size: 1.1em; opacity: 0.7;">Games Won</p>
            <h3 style="margin: 5px 0 0 0; font-size: 1.8em;">${stats.gamesWon}</h3>
          </div>
          <div class="stat-card" style="border:1.5px dashed var(--ink-color); padding: 8px; border-radius:5px;">
            <p style="margin: 0; font-size: 1.1em; opacity: 0.7;">Win Ratio</p>
            <h3 style="margin: 5px 0 0 0; font-size: 1.8em;">${winRate}%</h3>
          </div>
          <div class="stat-card" style="border:1.5px dashed var(--ink-color); padding: 8px; border-radius:5px;">
            <p style="margin: 0; font-size: 1.1em; opacity: 0.7;">Avg Solve Time</p>
            <h3 style="margin: 5px 0 0 0; font-size: 1.6em;">${formatTime(avgTimeSec)}</h3>
          </div>
          <div class="stat-card" style="border:1.5px dashed var(--ink-color); padding: 8px; border-radius:5px;">
            <p style="margin: 0; font-size: 1.1em; opacity: 0.7;">Current Streak</p>
            <h3 style="margin: 5px 0 0 0; font-size: 1.8em;">${stats.streaks.current} 🔥</h3>
          </div>
          <div class="stat-card" style="border:1.5px dashed var(--ink-color); padding: 8px; border-radius:5px;">
            <p style="margin: 0; font-size: 1.1em; opacity: 0.7;">Longest Streak</p>
            <h3 style="margin: 5px 0 0 0; font-size: 1.8em;">${stats.streaks.longest} 🏆</h3>
          </div>
        </div>
        ${heatmapHTML}
        <div style="text-align: center; margin-top: 25px;">
          <button id="reset-stats-btn" class="paper-btn" style="border-color: var(--incorrect-color); color: var(--incorrect-color);">🗑️ Clear Statistics</button>
        </div>
      </div>
    `;

    openModal("Drafting Statistics", bodyHTML);

    const resetBtn = document.getElementById('reset-stats-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        if (confirm("Are you sure you want to completely erase all statistics and streaks?")) {
          SoundFX.playErase();
          localStorage.removeItem('sudoku_stats_v2');
          closeModal();
          updateStatsDashboard();
        }
      });
    }
  }

  function showLeaderboardDrawer() {
    const records = getLeaderboard();
    const formatTime = (sec) => {
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      return `${m}:${s.toString().padStart(2, '0')}`;
    };

    let listHTML = `<div style="font-family: 'Nanum Pen Script', cursive; font-size: 1.4rem;">`;
    const diffs = ['easy', 'medium', 'hard', 'expert'];
    diffs.forEach(d => {
      const list = records[d] || [];
      listHTML += `
        <h4 style="margin: 15px 0 5px 0; border-bottom: 1.5px dashed var(--ink-color); padding-bottom: 2px; text-transform: uppercase;">📓 ${d} Records</h4>
      `;
      if (list.length === 0) {
        listHTML += `<p style="font-size:1.1em; opacity:0.6; margin: 5px 0 10px 10px;">No drafts completed yet.</p>`;
      } else {
        listHTML += `<ol style="margin: 5px 0 10px 20px; padding:0; line-height: 1.6;">`;
        list.forEach((rec, idx) => {
          listHTML += `
            <li style="margin-bottom:4px; font-size:1.2rem;">
              <strong>${formatTime(rec.time)}</strong> 
              <span style="font-size:0.95em; opacity:0.7;">on ${rec.date} (${rec.mistakes} mistakes)</span>
            </li>
          `;
        });
        listHTML += `</ol>`;
      }
    });
    listHTML += `</div>`;

    openModal("Fastest Solve Leaderboard", listHTML);
  }

  function showAchievementsDrawer() {
    const unlocked = getUnlockedAchievements();
    let listHTML = `
      <div style="font-family: 'Nanum Pen Script', cursive; font-size:1.35rem; display: flex; flex-direction: column; gap: 12px; max-height: 400px; overflow-y: auto; padding-right: 5px;">
    `;

    ACHIEVEMENTS.forEach(ach => {
      const isUnlocked = unlocked.includes(ach.id);
      listHTML += `
        <div class="achievement-row ${isUnlocked ? 'unlocked' : 'locked'}" style="display: flex; align-items: center; border: 1.5px solid ${isUnlocked ? 'var(--ink-color)' : '#ccc'}; opacity: ${isUnlocked ? '1' : '0.45'}; padding: 10px; border-radius: 6px; position: relative; overflow: hidden; background: ${isUnlocked ? 'rgba(0,0,0,0.02)' : 'none'};">
          <div style="font-size: 2.2em; margin-right: 15px; filter: ${isUnlocked ? 'none' : 'grayscale(100%)'};">${ach.icon}</div>
          <div style="flex: 1;">
            <h4 style="margin: 0; font-size: 1.25em;">${ach.title}</h4>
            <p style="margin: 3px 0 0 0; font-size: 0.95em; opacity: 0.8;">${ach.desc}</p>
          </div>
          ${isUnlocked ? '<div style="position: absolute; right: 8px; top: 8px; font-size: 0.85em; background: var(--ink-color); color: #fff; padding: 2px 6px; border-radius: 4px; font-family: monospace;">GOT IT</div>' : ''}
        </div>
      `;
    });
    listHTML += `</div>`;

    openModal("Scribble Achievements", listHTML);
  }

  function showRulesDrawer() {
    const ruleHTML = `
      <div style="font-family: 'Nanum Pen Script', cursive; font-size: 1.4rem; line-height: 1.6; max-height: 400px; overflow-y: auto; padding-right: 10px;">
        <h3 style="margin-top: 0; font-size: 1.6rem;">How to play Sudoku</h3>
        <p>The puzzle goal is to place numbers from 1 to 9 in empty spaces of the 9x9 grid, divided into nine 3x3 boxes, such that:</p>
        <ul>
          <li>Each row contains numbers 1-9 without repetition.</li>
          <li>Each column contains numbers 1-9 without repetition.</li>
          <li>Each 3x3 box contains numbers 1-9 without repetition.</li>
        </ul>
        <h3 style="margin-top: 15px; font-size: 1.5rem;">Keyboard Controls ⌨️</h3>
        <ul style="line-height: 1.8;">
          <li><strong>Arrow keys:</strong> Move active square selection</li>
          <li><strong>Numbers 1 to 9:</strong> Enter values (or notes)</li>
          <li><strong>Backspace / Delete / 0:</strong> Erase active square</li>
          <li><strong>'N' or 'n' key:</strong> Toggle Pencil / Note writing</li>
          <li><strong>'H' or 'h' key:</strong> Request AI logical hint</li>
          <li><strong>Ctrl + Z:</strong> Undo move</li>
          <li><strong>Ctrl + Y:</strong> Redo move</li>
          <li><strong>Escape:</strong> Deselect cell</li>
          <li><strong>Spacebar:</strong> Pause / Unpause the game</li>
        </ul>
      </div>
    `;
    openModal("Rules & Blueprint Instructions", ruleHTML);
  }

  function showImportExportDrawer() {
    const currentGridString = state.board.map(n => n === 0 ? '.' : n).join('');
    const bodyHTML = `
      <div style="font-family: 'Nanum Pen Script', cursive; font-size: 1.4rem; line-height: 1.6;">
        <h4 style="margin: 0 0 8px 0; font-size:1.5rem;">📦 Export Puzzle Draft</h4>
        <p style="font-size: 0.95em; opacity: 0.8; margin-bottom: 8px;">Copy this 81-character puzzle string to share your draft:</p>
        <textarea readonly id="export-textarea" style="width: 100%; height: 60px; font-family: monospace; font-size: 1.25rem; padding: 6px; border: 1.5px solid var(--ink-color); border-radius: 4px; resize: none; background: rgba(0,0,0,0.02);">${currentGridString}</textarea>
        <div style="text-align: right; margin-top: 5px;">
          <button id="copy-export-btn" class="paper-btn active-btn" style="padding: 4px 10px; font-size: 0.95em;">📋 Copy</button>
        </div>

        <h4 style="margin: 20px 0 8px 0; border-top: 1px dashed var(--ink-color); padding-top: 15px; font-size: 1.5rem;">📥 Import Puzzle Draft</h4>
        <p style="font-size: 0.95em; opacity: 0.8; margin-bottom: 8px;">Paste an 81-character string (numbers 1-9 or dots/zeros):</p>
        <input type="text" id="import-input" placeholder="e.g. 53..7....6..195....98....6.8..." style="width: 100%; font-family: monospace; font-size: 1.25rem; padding: 6px; border: 1.5px solid var(--ink-color); border-radius: 4px;">
        <div style="text-align: right; margin-top: 8px;">
          <button id="submit-import-btn" class="paper-btn active-btn" style="padding: 6px 14px;">💾 Load Draft</button>
        </div>
      </div>
    `;
    openModal("Import / Export Clipboard", bodyHTML);

    document.getElementById('copy-export-btn').addEventListener('click', () => {
      const area = document.getElementById('export-textarea');
      area.select();
      if (navigator.clipboard) {
        navigator.clipboard.writeText(area.value).then(() => alert("Export string copied!"));
      } else {
        alert("Clipboard not supported. Copy text manually.");
      }
    });

    document.getElementById('submit-import-btn').addEventListener('click', () => {
      const input = document.getElementById('import-input').value.trim();
      if (input.length !== 81) {
        alert("Error: String must be exactly 81 characters long!");
        return;
      }

      const parsedBoard = [];
      for (let i = 0; i < 81; i++) {
        const char = input[i];
        if (char >= '1' && char <= '9') {
          parsedBoard.push(parseInt(char));
        } else {
          parsedBoard.push(0);
        }
      }

      const sol = window.SudokuEngine.solve(parsedBoard);
      if (!sol) {
        alert("Error: Invalid Sudoku board! It does not have any valid solution.");
        return;
      }

      SoundFX.playPageFlip();
      state.board = [...parsedBoard];
      state.startBoard = [...parsedBoard];
      state.solution = sol;
      state.notes = Array.from({ length: 81 }, () => []);
      state.activeCellIdx = -1;
      state.mistakes = 0;
      state.elapsedTime = 0;
      state.totalNotesPlacedThisGame = 0;

      state.history = [];
      state.historyIndex = -1;
      pushHistory();

      state.isPlaying = true;
      state.isPaused = false;

      closeModal();
      renderBoard();
      startTimer();
      saveAutosave();
    });
  }

  function updateStatsDashboard() {}
  function updateLeaderboardView() {}
  function updateAchievementsView() {}

  // Keyboard Shortcuts
  function handleKeyboardShortcuts(e) {
    if (!state.isPlaying || state.isPaused) return;
    if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') {
      return;
    }

    const key = e.key;

    // Number keys 1-9
    if (key >= '1' && key <= '9') {
      e.preventDefault();
      handleNumberInput(parseInt(key));
    }
    else if (key === 'Backspace' || key === 'Delete' || key === '0') {
      e.preventDefault();
      eraseActiveCell();
    }
    else if (key === 'n' || key === 'N') {
      e.preventDefault();
      togglePencilMode();
    }
    else if (key === 'h' || key === 'H') {
      e.preventDefault();
      triggerAIHint();
    }
    else if ((e.ctrlKey && key === 'z') || (e.ctrlKey && key === 'Z')) {
      e.preventDefault();
      undoMove();
    }
    else if ((e.ctrlKey && key === 'y') || (e.ctrlKey && key === 'Y')) {
      e.preventDefault();
      redoMove();
    }
    else if (key === 'Escape') {
      e.preventDefault();
      state.activeCellIdx = -1;
      renderBoard();
    }
    else if (key === ' ') {
      e.preventDefault();
      togglePause();
    }
    // Navigation arrows
    else if (key.startsWith('Arrow')) {
      e.preventDefault();
      if (state.activeCellIdx === -1) {
        state.activeCellIdx = 0;
      } else {
        let r = Math.floor(state.activeCellIdx / 9);
        let c = state.activeCellIdx % 9;

        if (key === 'ArrowUp') r = (r - 1 + 9) % 9;
        else if (key === 'ArrowDown') r = (r + 1) % 9;
        else if (key === 'ArrowLeft') c = (c - 1 + 9) % 9;
        else if (key === 'ArrowRight') c = (c + 1) % 9;

        state.activeCellIdx = r * 9 + c;
      }
      SoundFX.playClick();
      renderBoard();
    }
  }

  // Canvas celebration confetti
  let confettiInterval = null;
  function startSketchConfetti() {
    const canvas = el.celebrationCanvas;
    const ctx = canvas.getContext('2d');
    
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    
    const particles = [];
    const maxParticles = 90;

    function createParticle() {
      return {
        x: Math.random() * canvas.width,
        y: Math.random() * -100 - 10,
        vx: Math.random() * 4 - 2,
        vy: Math.random() * 3 + 2,
        size: Math.random() * 8 + 4,
        type: ['line', 'circle', 'spiral', 'square'][Math.floor(Math.random() * 4)],
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: Math.random() * 0.1 - 0.05
      };
    }

    for (let i = 0; i < maxParticles; i++) {
      particles.push(createParticle());
    }

    clearInterval(confettiInterval);
    confettiInterval = setInterval(() => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      const inkColor = getComputedStyle(document.body).getPropertyValue('--ink-color').trim() || '#111';
      ctx.strokeStyle = inkColor;
      ctx.fillStyle = inkColor;
      ctx.lineWidth = 1.5;

      let finished = true;
      particles.forEach(p => {
        if (p.y < canvas.height + 20) {
          finished = false;
        }

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);

        ctx.beginPath();
        if (p.type === 'line') {
          ctx.moveTo(-p.size, 0);
          ctx.lineTo(p.size, 0);
          ctx.stroke();
        } else if (p.type === 'circle') {
          ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
          ctx.stroke();
        } else if (p.type === 'square') {
          ctx.strokeRect(-p.size/2, -p.size/2, p.size, p.size);
        } else if (p.type === 'spiral') {
          ctx.moveTo(0, 0);
          for (let angle = 0; angle < Math.PI * 3; angle += 0.5) {
            const r = (angle / (Math.PI * 3)) * p.size;
            ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
          }
          ctx.stroke();
        }

        ctx.restore();

        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.rotSpeed;

        if (p.y > canvas.height + 15 && el.celebrationOverlay.classList.contains('active')) {
          p.y = -20;
          p.x = Math.random() * canvas.width;
          p.vy = Math.random() * 3 + 2;
        }
      });

      if (finished && !el.celebrationOverlay.classList.contains('active')) {
        clearInterval(confettiInterval);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }, 1000 / 60);
  }

})();
