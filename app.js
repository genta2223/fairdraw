/**
 * fairdraw - 公平な順番決定システム
 * 2段階フェーズ式くじ引きに対応 (1回目: 議席順にくじを引き「くじを引く順(番手)」を決定 ➔ 2回目: 決定した番手順に本番くじを引き「質問順」を決定)
 * 議席番号に対応、一括追加UI、各種バグ修正済、オフラインCORS回避版
 */

// ==========================================
// 1. 公平な抽選ロジック (CSPRNG & Fisher-Yates)
// ==========================================

function getRandomUint32() {
  if (typeof window !== 'undefined' && window.crypto) {
    const array = new Uint32Array(1);
    window.crypto.getRandomValues(array);
    return array[0];
  } else {
    throw new Error('暗号学的乱数生成器 (CSPRNG) がブラウザで利用できません。最新のブラウザをご利用ください。');
  }
}

function fairShuffle(array) {
  const items = [...array];
  const n = items.length;
  const rawRandomValues = [];
  
  for (let i = n - 1; i > 0; i--) {
    const randUint32 = getRandomUint32();
    const maxVal = 4294967296 - (4294967296 % (i + 1));
    let rand = randUint32;
    while (rand >= maxVal) {
      rand = getRandomUint32();
    }
    const j = rand % (i + 1);
    
    rawRandomValues.push({
      step: n - i,
      targetRange: `0 to ${i}`,
      chosenIndex: j,
      rawUint32: randUint32
    });
    
    const temp = items[i];
    items[i] = items[j];
    items[j] = temp;
  }

  const timestamp = new Date().toISOString();
  
  const auditLog = {
    title: '公平な順番決定システム 監査ログ',
    timestamp: timestamp,
    originalParticipants: [...array],
    shuffledOrder: [...items],
    randomnessEngine: 'Web Crypto API (window.crypto)',
    steps: rawRandomValues,
    verificationCode: btoa(unescape(encodeURIComponent(JSON.stringify({ timestamp, originalParticipants: array, shuffledOrder: items, rawRandomValues }))))
  };

  return {
    shuffled: items,
    auditLog: auditLog
  };
}

// ==========================================
// 2. アプリケーション状態 & 定数
// ==========================================

// 与那国町議会 実際の公式議席番号（2025年補選完了後時点の正しい組み合わせ）
const DEFAULT_MEMBERS = [
  { id: '1', seat: 1, name: '杉本 英貴', active: true },
  { id: '2', seat: 2, name: '小島 重喜', active: true },
  { id: '3', seat: 3, name: '阪口 源太', active: true },
  { id: '4', seat: 4, name: '小嶺 博泉', active: true },
  { id: '5', seat: 5, name: '与那覇 英作', active: true },
  { id: '6', seat: 6, name: '与那原 繁', active: true },
  { id: '7', seat: 7, name: '崎元 俊男', active: true },
  { id: '8', seat: 8, name: '上原 光秀', active: true },
  { id: '9', seat: 9, name: '嵩西 茂則', active: true },
  { id: '10', seat: 10, name: '大宜見 浩利', active: true }
];

const PRESETS = {
  yonaguni: DEFAULT_MEMBERS,
  empty: []
};

// 状態管理
let state = {
  members: [],
  currentPhase: 1, // 1: くじ順決定フェーズ, 2: 質問順決定フェーズ
  isDeleteMode: false,

  // フェーズ1の進行状態
  phase1Queue: [], // 1回目で「くじを引く人」のキュー（議席順ソート済み、{ id, name, seat } 形式）
  phase1Index: 0, // 現在引いている順番のインデックス
  phase1Pool: [], // 1回目に引く「くじ順カード（1番手〜N番手）」のシャッフルされた山
  phase1Results: [], // 1回目の結果。 { name: '議員名', drawRank: 3 }
  phase1AuditLog: null,

  // フェーズ2の進行状態
  drawOrder: [], // 2回目で「くじを引く人」の順番（1回目の結果 drawRank 順にソートされた議員名リスト）
  phase2Index: 0, // 2回目の現在のインデックス
  phase2Pool: [], // 2回目に引く「質問順カード（1番〜N番）」のシャッフルされた山
  phase2Results: [], // 2回目の最終結果。 { name: '議員名', questionRank: 5 }
  phase2AuditLog: null
};

// ==========================================
// 3. UI 制御 & DOM 操作
// ==========================================

let memberListContainer, btnAddMember, btnBatchAdd, btnTriggerCsv, inputCsvFile, btnResetMembers, checkAllMembers;
let totalCountEl, activeCountEl, presetSelect, btnLoadPreset, btnToggleDelete, btnCancelDelete, btnRestartDraw;
let btnStartDraw, btnAutoDraw, btnSaveResults, resultsPanel, resultsDrawOrderBody, resultsQuestionOrderBody;
let auditLogText, btnCopyLog, btnDownloadLog;
let ballContainer, gachaMachine, gachaLever, capsuleModal, capsuleDrawNumber, capsuleDrawName;
let phaseStatus, lotteryArena, leverInstructionText;

function init() {
  // DOM要素
  memberListContainer = document.getElementById('member-list');
  btnAddMember = document.getElementById('btn-add-member');
  btnBatchAdd = document.getElementById('btn-batch-add');
  btnTriggerCsv = document.getElementById('btn-trigger-csv');
  inputCsvFile = document.getElementById('input-csv-file');
  btnToggleDelete = document.getElementById('btn-toggle-delete');
  btnCancelDelete = document.getElementById('btn-cancel-delete');
  btnRestartDraw = document.getElementById('btn-restart-draw');
  btnResetMembers = document.getElementById('btn-reset-members');
  checkAllMembers = document.getElementById('check-all-members');
  totalCountEl = document.getElementById('total-count');
  activeCountEl = document.getElementById('active-count');
  presetSelect = document.getElementById('preset-select');
  btnLoadPreset = document.getElementById('btn-load-preset');

  btnStartDraw = document.getElementById('btn-start-draw');
  btnAutoDraw = document.getElementById('btn-auto-draw');
  btnSaveResults = document.getElementById('btn-save-results');
  resultsPanel = document.getElementById('results-panel');
  resultsDrawOrderBody = document.getElementById('results-draw-order-body');
  resultsQuestionOrderBody = document.getElementById('results-question-order-body');
  auditLogText = document.getElementById('audit-log-text');
  btnCopyLog = document.getElementById('btn-copy-log');
  btnDownloadLog = document.getElementById('btn-download-log');

  ballContainer = document.getElementById('ball-container');
  gachaMachine = document.getElementById('gacha-machine');
  gachaLever = document.getElementById('gacha-lever');
  capsuleModal = document.getElementById('lottery-capsule-modal');
  capsuleDrawNumber = document.getElementById('capsule-draw-number');
  capsuleDrawName = document.getElementById('capsule-draw-name');

  phaseStatus = document.getElementById('phase-status');
  lotteryArena = document.getElementById('lottery-arena');
  leverInstructionText = document.getElementById('lever-instruction-text');

  loadState();
  renderMembers();
  setupGachaBalls();
  setupEventListeners();
  updatePhaseUI();
}

function loadState() {
  const saved = localStorage.getItem('fairdraw_state');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed && Array.isArray(parsed.members)) {
        state.members = parsed.members;
      } else {
        state.members = JSON.parse(JSON.stringify(DEFAULT_MEMBERS));
      }
    } catch (e) {
      console.error('State load error:', e);
      state.members = JSON.parse(JSON.stringify(DEFAULT_MEMBERS));
    }
  } else {
    state.members = JSON.parse(JSON.stringify(DEFAULT_MEMBERS));
  }
  
  // 議席番号で名簿をソート (空白は最後尾)
  sortMembersBySeat();
  resetLotteryState();
}

// 議席番号で名簿を昇順ソートするヘルパー (空白は最後尾)
function sortMembersBySeat() {
  state.members.sort((a, b) => {
    const aSeat = (a.seat !== null && a.seat !== undefined && a.seat !== '') ? parseInt(a.seat, 10) : Infinity;
    const bSeat = (b.seat !== null && b.seat !== undefined && b.seat !== '') ? parseInt(b.seat, 10) : Infinity;
    
    const aNum = isNaN(aSeat) ? Infinity : aSeat;
    const bNum = isNaN(bSeat) ? Infinity : bSeat;
    
    return aNum - bNum;
  });
}

function resetLotteryState() {
  state.currentPhase = 1;
  state.isDeleteMode = false;
  state.phase1Queue = [];
  state.phase1Index = 0;
  state.phase1Pool = [];
  state.phase1Results = [];
  state.phase1AuditLog = null;
  state.drawOrder = [];
  state.phase2Index = 0;
  state.phase2Pool = [];
  state.phase2Results = [];
  state.phase2AuditLog = null;
  
  if (resultsPanel) {
    resultsPanel.classList.add('hidden');
  }
}

function saveState() {
  // 保存する前に議席順にソートする
  sortMembersBySeat();
  localStorage.setItem('fairdraw_state', JSON.stringify({
    members: state.members
  }));
}

function renderMembers() {
  memberListContainer.innerHTML = '';
  let activeCount = 0;

  state.members.forEach((member) => {
    if (member.active) activeCount++;

    const item = document.createElement('div');
    item.className = 'member-item';
    
    let actionHtml = '';
    if (state.isDeleteMode) {
      actionHtml = `<input type="checkbox" class="delete-checkbox" data-delete-id="${member.id}" title="この議員を削除する">`;
    }

    item.innerHTML = `
      <div class="col-seat">
        <input type="number" data-seat-id="${member.id}" value="${member.seat || ''}" min="1" max="99" placeholder="番" ${state.phase1Index > 0 || state.currentPhase === 2 ? 'disabled' : ''}>
      </div>
      <div class="col-check">
        <input type="checkbox" data-id="${member.id}" ${member.active ? 'checked' : ''} ${state.phase1Index > 0 || state.currentPhase === 2 ? 'disabled' : ''}>
      </div>
      <div class="col-name">
        <input type="text" data-id="${member.id}" value="${escapeHtml(member.name)}" placeholder="氏名を入力" ${state.phase1Index > 0 || state.currentPhase === 2 ? 'disabled' : ''}>
      </div>
      <div class="col-action">
        ${actionHtml}
      </div>
    `;
    memberListContainer.appendChild(item);
  });

  totalCountEl.textContent = state.members.length;
  activeCountEl.textContent = activeCount;

  checkAllMembers.checked = state.members.length > 0 && state.members.every(m => m.active);
  
  const isStarted = state.phase1Index > 0 || state.currentPhase === 2;
  
  if (isStarted) {
    checkAllMembers.disabled = true;
    btnAddMember.disabled = true;
    btnBatchAdd.disabled = true;
    btnTriggerCsv.disabled = true;
    btnResetMembers.disabled = true;
    btnLoadPreset.disabled = true;
    presetSelect.disabled = true;
    btnToggleDelete.disabled = true;
    btnCancelDelete.classList.add('hidden');
  } else {
    checkAllMembers.disabled = false;
    btnToggleDelete.disabled = false;

    if (state.isDeleteMode) {
      btnCancelDelete.classList.remove('hidden');
      btnAddMember.disabled = true;
      btnBatchAdd.disabled = true;
      btnTriggerCsv.disabled = true;
      btnResetMembers.disabled = true;
      btnLoadPreset.disabled = true;
      presetSelect.disabled = true;
    } else {
      btnCancelDelete.classList.add('hidden');
      btnAddMember.disabled = false;
      btnBatchAdd.disabled = false;
      btnTriggerCsv.disabled = false;
      btnResetMembers.disabled = false;
      btnLoadPreset.disabled = false;
      presetSelect.disabled = false;
    }
  }
}

function setupGachaBalls() {
  ballContainer.innerHTML = '';
  const activeMembers = state.members.filter(m => m.active);
  
  let ballCount = activeMembers.length;
  if (state.currentPhase === 1) {
    // 1回目の残りのくじ数
    ballCount = activeMembers.length - state.phase1Index;
  } else if (state.currentPhase === 2) {
    // 2回目の残りのくじ数
    ballCount = state.phase2Pool.length;
  }

  const colors = [
    'radial-gradient(circle at 30% 30%, #ff5252, #c62828)',
    'radial-gradient(circle at 30% 30%, #ff4081, #c2185b)',
    'radial-gradient(circle at 30% 30%, #e040fb, #7b1fa2)',
    'radial-gradient(circle at 30% 30%, #7c4dff, #4527a0)',
    'radial-gradient(circle at 30% 30%, #53d3ff, #0091ea)',
    'radial-gradient(circle at 30% 30%, #69f0ae, #2e7d32)',
    'radial-gradient(circle at 30% 30%, #ffd740, #ff8f00)',
    'radial-gradient(circle at 30% 30%, #ff6e40, #d84315)'
  ];

  for (let i = 0; i < ballCount; i++) {
    const ball = document.createElement('div');
    ball.className = 'lottery-ball';
    const angle = Math.random() * Math.PI * 2;
    const r = Math.random() * 45;
    const x = 75 + Math.cos(angle) * r - 12;
    const y = 75 + Math.sin(angle) * r - 12;

    ball.style.left = `${x}px`;
    ball.style.top = `${y}px`;
    ball.style.background = colors[i % colors.length];
    ballContainer.appendChild(ball);
  }
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function updatePhaseUI() {
  if (state.currentPhase === 1) {
    phaseStatus.className = 'phase-status-bar phase-1-active';
    lotteryArena.classList.remove('phase-2-theme');
    
    // 最初の準備状態か、引き始めているか
    if (state.phase1Queue.length === 0) {
      leverInstructionText.textContent = '1回目: 議席順に「くじ順(番手)」を引きます。準備完了！';
      btnStartDraw.textContent = '1. くじを引く準備（開始）';
      btnStartDraw.className = 'btn btn-primary btn-lg btn-glow';
      btnAutoDraw.classList.add('hidden');
    } else if (state.phase1Index < state.phase1Queue.length) {
      const nextMember = state.phase1Queue[state.phase1Index];
      const seatText = nextMember.seat ? `(議席:${nextMember.seat}番)` : '(議席なし)';
      leverInstructionText.textContent = `次は議席順 ${state.phase1Index + 1}番手： ${nextMember.name} 議員 ${seatText} が引きます`;
      btnStartDraw.textContent = `${nextMember.name} 議員が「くじ順」を引く`;
      btnStartDraw.className = 'btn btn-primary btn-lg btn-glow';
      btnAutoDraw.classList.remove('hidden');
    } else {
      leverInstructionText.textContent = '全員がくじ順を決定しました！2回目へ進みます。';
      btnStartDraw.textContent = '2. 一般質問順の決定（本番）へ進む';
      btnStartDraw.className = 'btn btn-secondary btn-lg';
      btnAutoDraw.classList.add('hidden');
    }
    btnSaveResults.classList.add('hidden');
  } else {
    phaseStatus.className = 'phase-status-bar phase-2-active';
    lotteryArena.classList.add('phase-2-theme');
    
    if (state.phase2Index < state.drawOrder.length) {
      const nextMember = state.drawOrder[state.phase2Index];
      leverInstructionText.textContent = `次はくじ順 ${state.phase2Index + 1}番手： ${nextMember} 議員が本番を引きます`;
      btnStartDraw.textContent = `【${state.phase2Index + 1}番手】${nextMember} 議員が質問順を引く`;
      btnStartDraw.className = 'btn btn-primary btn-lg btn-glow';
      btnAutoDraw.classList.remove('hidden');
      
      // まだ引いている途中の場合は非表示を維持
      btnSaveResults.classList.add('hidden');
    } else {
      leverInstructionText.textContent = 'すべての一般質問順序が決定しました！';
      btnStartDraw.textContent = '最初からやり直す';
      btnStartDraw.className = 'btn btn-secondary btn-lg';
      btnAutoDraw.classList.add('hidden');
      
      // 全員引き終わっている場合のみ表示
      btnSaveResults.classList.remove('hidden');
    }
  }
}

function setupEventListeners() {
  // 1名追加
  btnAddMember.addEventListener('click', () => {
    if (state.phase1Index > 0 || state.currentPhase === 2) return;
    
    const name = prompt('追加する議員の氏名を入力してください:');
    if (name === null) return;
    const trimmedName = name.trim();
    if (trimmedName === '') {
      alert('氏名が入力されていません。');
      return;
    }

    // 空いている最も若い議席番号（欠番）を自動検出
    const assignedSeats = state.members
      .map(m => parseInt(m.seat, 10))
      .filter(s => !isNaN(s) && s > 0);
    
    let defaultSeat = 1;
    while (assignedSeats.includes(defaultSeat)) {
      defaultSeat++;
    }

    const seatInput = prompt('議席番号を入力してください (半角数字):', defaultSeat);
    if (seatInput === null) return;
    const seatVal = parseInt(seatInput, 10) || null;

    const newId = `id-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
    state.members.push({
      id: newId,
      seat: seatVal,
      name: trimmedName,
      active: true
    });
    saveState();
    renderMembers();
    setupGachaBalls();
  });

  // 一括追加
  btnBatchAdd.addEventListener('click', () => {
    if (state.phase1Index > 0 || state.currentPhase === 2) return;
    
    const input = prompt(
      '追加したい複数の議員名を「読点（、）」または「スペース」または「改行」で区切って入力してください:\n(例: 久部良太郎、祖納次郎、比川三郎)'
    );
    if (input === null) return;

    const names = input
      .split(/[、\s\n\r]+/)
      .map(n => n.trim())
      .filter(n => n !== '');

    if (names.length === 0) {
      alert('入力された名前が見つかりませんでした。');
      return;
    }

    const startSeat = state.members.length + 1;
    names.forEach((name, idx) => {
      const newId = `id-${Date.now()}-${idx}-${Math.random().toString(36).substr(2, 4)}`;
      state.members.push({
        id: newId,
        seat: startSeat + idx,
        name: name,
        active: true
      });
    });

    saveState();
    renderMembers();
    setupGachaBalls();
    alert(`${names.length}名の議員を一括追加しました。`);
  });

  // CSV読み込みトリガー
  btnTriggerCsv.addEventListener('click', () => {
    if (state.phase1Index > 0 || state.currentPhase === 2) return;
    inputCsvFile.click();
  });

  // CSVファイル選択・パース
  inputCsvFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(evt) {
      const text = evt.target.result;
      const lines = text.split(/\r\n|\n/);
      
      const parsedMembers = [];
      let duplicateSeats = [];
      let seatsUsed = [];
      let isFirstLine = true;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line === '') continue;

        // カンマ区切りでパース
        const columns = line.split(',');
        if (columns.length < 2) {
          continue;
        }

        const seatRaw = columns[0].trim();
        const name = columns[1].trim();

        if (name === '') continue;

        // ヘッダー行の自動判別とスキップ
        if (isFirstLine) {
          isFirstLine = false;
          const isNum = !isNaN(parseInt(seatRaw, 10));
          const isEmpty = seatRaw === '';
          // 最初の行であり、1列目が空でも数字でもない場合（例: "議席番号"、"seat" など）、ヘッダーと見なしてスキップ
          if (!isNum && !isEmpty) {
            continue;
          }
        }

        let seat = parseInt(seatRaw, 10);
        if (isNaN(seat)) {
          seat = null;
        }

        if (seat !== null) {
          if (seatsUsed.includes(seat)) {
            duplicateSeats.push(seat);
          } else {
            seatsUsed.push(seat);
          }
        }

        parsedMembers.push({
          id: `csv-${Date.now()}-${i}-${Math.random().toString(36).substr(2, 4)}`,
          seat: seat,
          name: name,
          active: true
        });
      }

      if (parsedMembers.length === 0) {
        alert('有効な議員データが見つかりませんでした。CSVのフォーマットは「議席番号,氏名」の形式にしてください。');
        inputCsvFile.value = '';
        return;
      }

      if (duplicateSeats.length > 0) {
        alert(`エラー: CSV内で以下の議席番号が重複しています。\n【議席番号: ${[...new Set(duplicateSeats)].join(', ')}】\nデータを修正してやり直してください。`);
        inputCsvFile.value = '';
        return;
      }

      if (confirm(`CSVから ${parsedMembers.length} 名の議員データを読み込み、現在のリストを上書きしますか？`)) {
        state.members = parsedMembers;
        sortMembersBySeat();
        saveState();
        renderMembers();
        setupGachaBalls();
        alert(`${parsedMembers.length} 名のデータをインポートしました。`);
      }
      
      inputCsvFile.value = '';
    };

    reader.onerror = function() {
      alert('ファイルの読み込み中にエラーが発生しました。');
      inputCsvFile.value = '';
    };

    reader.readAsText(file, 'UTF-8');
  });

  btnLoadPreset.addEventListener('click', () => {
    if (state.phase1Index > 0 || state.currentPhase === 2) return;
    const selectedKey = presetSelect.value;
    if (PRESETS[selectedKey]) {
      const label = presetSelect.options[presetSelect.selectedIndex].text;
      if (confirm(`議員名簿を「${label}」で上書きしますか？`)) {
        state.members = PRESETS[selectedKey].map((m, idx) => ({
          id: `preset-${idx}-${Date.now()}`,
          seat: m.seat,
          name: m.name,
          active: m.active
        }));
        sortMembersBySeat(); // ソート
        saveState();
        resetLotteryState();
        renderMembers();
        setupGachaBalls();
        updatePhaseUI();
      }
    }
  });

  btnResetMembers.addEventListener('click', () => {
    if (state.phase1Index > 0 || state.currentPhase === 2) return;
    if (state.isDeleteMode) {
      state.isDeleteMode = false;
      btnToggleDelete.textContent = '議員を削除する';
      btnToggleDelete.classList.remove('btn-danger-active');
    }
    
    if (confirm('【警告】登録されている議員名簿データを「すべて消去」し、初期状態（与那国町議会10名）に戻します。\n本当によろしいですか？')) {
      if (confirm('本当によろしいですね？名簿の編集内容は完全に失われます。')) {
        state.members = JSON.parse(JSON.stringify(DEFAULT_MEMBERS));
        sortMembersBySeat(); // ソート
        saveState();
        resetLotteryState();
        renderMembers();
        setupGachaBalls();
        updatePhaseUI();
      }
    }
  });

  // 削除モードの切り替え & 削除実行
  btnToggleDelete.addEventListener('click', () => {
    if (!state.isDeleteMode) {
      state.isDeleteMode = true;
      btnToggleDelete.textContent = '選択した議員を削除（確定）';
      btnToggleDelete.classList.add('btn-danger-active');
      renderMembers();
    } else {
      const checkedBoxes = memberListContainer.querySelectorAll('.delete-checkbox:checked');
      if (checkedBoxes.length === 0) {
        state.isDeleteMode = false;
        btnToggleDelete.textContent = '議員を削除する';
        btnToggleDelete.classList.remove('btn-danger-active');
        renderMembers();
        return;
      }

      const deleteIds = Array.from(checkedBoxes).map(cb => cb.dataset.deleteId);
      const deleteNames = state.members
        .filter(m => deleteIds.includes(m.id))
        .map(m => m.name);

      if (confirm(`本当に以下の議員を名簿から削除しますか？\n\n・${deleteNames.join('\n・')}`)) {
        state.members = state.members.filter(m => !deleteIds.includes(m.id));
        sortMembersBySeat(); // ソート
        saveState();
        state.isDeleteMode = false;
        btnToggleDelete.textContent = '議員を削除する';
        btnToggleDelete.classList.remove('btn-danger-active');
        renderMembers();
        setupGachaBalls();
      }
    }
  });

  btnCancelDelete.addEventListener('click', () => {
    state.isDeleteMode = false;
    btnToggleDelete.textContent = '議員を削除する';
    btnToggleDelete.classList.remove('btn-danger-active');
    renderMembers();
  });

  checkAllMembers.addEventListener('change', (e) => {
    if (state.phase1Index > 0 || state.currentPhase === 2) return;
    const checked = e.target.checked;
    state.members.forEach(m => m.active = checked);
    saveState();
    renderMembers();
    setupGachaBalls();
  });

  memberListContainer.addEventListener('change', (e) => {
    if (state.phase1Index > 0 || state.currentPhase === 2) return;
    const id = e.target.dataset.id;
    if (id && e.target.type === 'checkbox') {
      const member = state.members.find(m => m.id === id);
      if (member) {
        member.active = e.target.checked;
        saveState();
        renderMembers();
        setupGachaBalls();
      }
    }
  });

  // 議席入力欄からフォーカスが外れたタイミングで自動ソート
  memberListContainer.addEventListener('focusout', (e) => {
    if (state.phase1Index > 0 || state.currentPhase === 2) return;
    if (e.target.dataset.seatId) {
      sortMembersBySeat();
      saveState();
      renderMembers();
      setupGachaBalls();
    }
  });

  // リアルタイム入力変更
  memberListContainer.addEventListener('input', (e) => {
    if (state.phase1Index > 0 || state.currentPhase === 2) return;
    const id = e.target.dataset.id || e.target.dataset.seatId;
    if (!id) return;
    const member = state.members.find(m => m.id === id);
    if (!member) return;

    if (e.target.dataset.seatId) {
      member.seat = parseInt(e.target.value, 10) || null;
    } else if (e.target.dataset.id && e.target.type === 'text') {
      member.name = e.target.value;
    }
    saveState();
  });

  // 抽選を最初からやり直す（途中リセット）
  btnRestartDraw.addEventListener('click', () => {
    if (confirm('現在の抽選結果をすべて破棄し、1回目の「くじを引く準備」からやり直しますか？\n（議員名簿データは削除されません）')) {
      resetLotteryState();
      renderMembers();
      setupGachaBalls();
      updatePhaseUI();
    }
  });

  // 統合された手動くじ引き処理
  const handleDrawAction = async () => {
    const activeMembers = state.members.filter(m => m.active);
    if (activeMembers.length < 2) {
      alert('抽選には少なくとも2人以上の参加議員が必要です。');
      return;
    }

    if (state.currentPhase === 1) {
      // ==========================================
      // 【フェーズ 1】 くじ順決定フェーズ
      // ==========================================
      
      // 1-1. 最初のみ：キューとくじ箱(Pool)の準備
      if (state.phase1Queue.length === 0) {
        // 重複チェック
        const seatsUsed = [];
        const duplicateSeats = [];
        activeMembers.forEach(m => {
          if (m.seat !== null && m.seat !== undefined && m.seat !== '') {
            const seatNum = parseInt(m.seat, 10);
            if (seatsUsed.includes(seatNum)) {
              if (!duplicateSeats.includes(seatNum)) duplicateSeats.push(seatNum);
            } else {
              seatsUsed.push(seatNum);
            }
          }
        });

        if (duplicateSeats.length > 0) {
          alert(`エラー: 以下の議席番号が重複しています。\n【議席番号: ${duplicateSeats.join(', ')}】\n修正してから開始してください。`);
          return;
        }

        // ソート
        const assigned = [];
        const unassigned = [];
        activeMembers.forEach(m => {
          const seatVal = m.seat !== null && m.seat !== undefined && m.seat !== '' ? parseInt(m.seat, 10) : null;
          if (seatVal !== null && !isNaN(seatVal)) {
            assigned.push(m);
          } else {
            unassigned.push(m);
          }
        });
        
        assigned.sort((a, b) => a.seat - b.seat);
        
        let sortedUnassigned = [...unassigned];
        if (unassigned.length > 0) {
          const shuffleRes = fairShuffle(unassigned);
          sortedUnassigned = shuffleRes.shuffled;
        }

        state.phase1Queue = [...assigned, ...sortedUnassigned];
        
        // 番手カードプール
        const originalPool = Array.from({ length: activeMembers.length }, (_, idx) => idx + 1);
        const poolShuffle = fairShuffle(originalPool);
        state.phase1Pool = poolShuffle.shuffled;
        state.phase1AuditLog = poolShuffle.auditLog;
        
        state.phase1Index = 0;
        state.phase1Results = [];
        
        renderMembers();
        updatePhaseUI();
        return;
      }

      // 1-2. 既に全員引き終わっている場合 ➔ フェーズ2へ移行するトリガー
      if (state.phase1Index >= state.phase1Queue.length) {
        // フェーズ2に必要な変数をあらかじめセットして移行
        const sorted = [...state.phase1Results].sort((a, b) => a.drawRank - b.drawRank);
        state.drawOrder = sorted.map(r => r.name);
        
        const originalPool = Array.from({ length: activeMembers.length }, (_, idx) => idx + 1);
        const poolShuffle = fairShuffle(originalPool);
        state.phase2Pool = poolShuffle.shuffled;
        state.phase2AuditLog = poolShuffle.auditLog;
        
        state.phase2Index = 0;
        state.finalResults = [];

        state.currentPhase = 2; // 確実にフェーズを2にする
        
        setupGachaBalls();
        renderMembers();
        updatePhaseUI(); // UIテキストやテーマクラスの切り替え
        return;
      }

      // 1-3. 1人分引く
      btnStartDraw.disabled = true;
      btnAutoDraw.disabled = true;
      
      const currentMember = state.phase1Queue[state.phase1Index];
      const drawnDrawRank = state.phase1Pool.pop();
      
      state.phase1Results.push({
        name: currentMember.name,
        drawRank: drawnDrawRank
      });

      // ガチャ回転演出
      gachaMachine.classList.add('gacha-spinning');
      await new Promise(resolve => setTimeout(resolve, 1000));
      gachaMachine.classList.remove('gacha-spinning');

      // 結果カプセル
      capsuleModal.classList.remove('hidden');
      capsuleModal.classList.remove('closing');
      capsuleModal.classList.add('active-animation'); // アニメーションを活性化
      void capsuleModal.offsetWidth; // 強制リフローでiOS Safariでの表示不具合を防止
      capsuleDrawNumber.textContent = `くじを引く順(番手) 決定`;
      capsuleDrawName.innerHTML = `<span style="font-size:0.9rem; color:var(--text-muted);">${currentMember.name} 議員</span><br><span style="color:var(--primary); font-size:1.4rem;">【第 ${drawnDrawRank} 番手】</span>`;

      await new Promise(resolve => setTimeout(resolve, 2200));

      capsuleModal.classList.add('closing');
      await new Promise(resolve => setTimeout(resolve, 200));
      capsuleModal.classList.add('hidden');
      capsuleModal.classList.remove('active-animation'); // 次回のためにリセット

      renderDrawOrderTable();
      setupGachaBalls();

      state.phase1Index++;
      
      btnStartDraw.disabled = false;
      btnAutoDraw.disabled = false;
      updatePhaseUI();
      
      resultsPanel.classList.remove('hidden'); // ここで即座に非表示解除
      showAuditLogs(); // 1回目手動ステップ後にリアルタイム出力

    } else if (state.currentPhase === 2) {
      // ==========================================
      // 【フェーズ 2】 一般質問順決定（本番）
      // ==========================================
      
      // 移行初期化（万が一変数初期化が抜けていた場合のセーフガード）
      if (state.phase2Pool.length === 0 && state.finalResults.length === 0) {
        const sorted = [...state.phase1Results].sort((a, b) => a.drawRank - b.drawRank);
        state.drawOrder = sorted.map(r => r.name);
        
        const originalPool = Array.from({ length: activeMembers.length }, (_, idx) => idx + 1);
        const poolShuffle = fairShuffle(originalPool);
        state.phase2Pool = poolShuffle.shuffled;
        state.phase2AuditLog = poolShuffle.auditLog;
        
        state.phase2Index = 0;
        state.finalResults = [];
      }

      // 全員引き終わっている場合、リセット
      if (state.phase2Index >= state.drawOrder.length) {
        if (confirm('名簿設定に戻り、最初から抽選をやり直しますか？')) {
          resetLotteryState();
          renderMembers();
          setupGachaBalls();
          updatePhaseUI();
        }
        return;
      }

      btnStartDraw.disabled = true;
      btnAutoDraw.disabled = true;
      
      const currentMember = state.drawOrder[state.phase2Index];
      const finalRank = state.phase2Pool.pop(); // 山から1枚引く
      
      state.finalResults.push({
        name: currentMember,
        questionRank: finalRank
      });

      gachaMachine.classList.add('gacha-spinning');
      await new Promise(resolve => setTimeout(resolve, 1000));
      gachaMachine.classList.remove('gacha-spinning');

      capsuleModal.classList.remove('hidden');
      capsuleModal.classList.remove('closing');
      capsuleModal.classList.add('active-animation'); // アニメーションを活性化
      void capsuleModal.offsetWidth; // 強制リフロー
      capsuleDrawNumber.textContent = `一般質問順序 確定`;
      capsuleDrawName.innerHTML = `<span style="font-size:0.9rem; color:var(--text-muted);">${currentMember} 議員</span><br><span style="color:var(--secondary); font-size:1.4rem;">【第 ${finalRank} 番】</span>`;

      await new Promise(resolve => setTimeout(resolve, 2200));

      capsuleModal.classList.add('closing');
      await new Promise(resolve => setTimeout(resolve, 200));
      capsuleModal.classList.add('hidden');

      renderQuestionOrderTable();
      setupGachaBalls();

      state.phase2Index++;
      btnStartDraw.disabled = false;
      btnAutoDraw.disabled = false;
      updatePhaseUI();
      showAuditLogs(); // 2回目手動ステップ後にリアルタイム出力

      // 最後の人が引き終わった場合
      if (state.phase2Index >= state.drawOrder.length) {
        btnSaveResults.classList.remove('hidden');
      }
    }
  };

  // 「残りを全自動で引く」処理 (1回目と2回目の両方に対応)
  const handleAutoDrawAction = async () => {
    btnStartDraw.disabled = true;
    btnAutoDraw.disabled = true;

    if (state.currentPhase === 1) {
      // 1回目の残りを自動で引く
      while (state.phase1Index < state.phase1Queue.length) {
        const currentMember = state.phase1Queue[state.phase1Index];
        const drawnDrawRank = state.phase1Pool.pop();
        
        state.phase1Results.push({
          name: currentMember.name,
          drawRank: drawnDrawRank
        });

        gachaMachine.classList.add('gacha-spinning');
        await new Promise(resolve => setTimeout(resolve, 900));
        gachaMachine.classList.remove('gacha-spinning');

        capsuleModal.classList.remove('hidden');
        capsuleModal.classList.remove('closing');
        capsuleModal.classList.add('active-animation'); // アニメーションを活性化
        void capsuleModal.offsetWidth; // 強制リフロー
        capsuleDrawNumber.textContent = `くじを引く順(番手) 決定`;
        capsuleDrawName.innerHTML = `<span style="font-size:0.9rem; color:var(--text-muted);">${currentMember.name} 議員</span><br><span style="color:var(--primary); font-size:1.4rem;">【第 ${drawnDrawRank} 番手】</span>`;

        await new Promise(resolve => setTimeout(resolve, 1200));

        capsuleModal.classList.add('closing');
        await new Promise(resolve => setTimeout(resolve, 200));
        capsuleModal.classList.add('hidden');
        capsuleModal.classList.remove('active-animation'); // 次回のためにリセット

        renderDrawOrderTable();
        setupGachaBalls();
        state.phase1Index++;
        updatePhaseUI();
        showAuditLogs(); // 1回目自動処理中にリアルタイム出力
        
        resultsPanel.classList.remove('hidden');
        
        // 次の抽選演出に移る前に、ブラウザが描画を完了するためのわずかなディレイを追加 (iOSの連続フリーズ対策)
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    } else if (state.currentPhase === 2) {
      // 2回目の残りを自動で引く
      while (state.phase2Index < state.drawOrder.length) {
        const currentMember = state.drawOrder[state.phase2Index];
        const finalRank = state.phase2Pool.pop();
        
        state.finalResults.push({
          name: currentMember,
          questionRank: finalRank
        });

        gachaMachine.classList.add('gacha-spinning');
        await new Promise(resolve => setTimeout(resolve, 900));
        gachaMachine.classList.remove('gacha-spinning');

        capsuleModal.classList.remove('hidden');
        capsuleModal.classList.remove('closing');
        capsuleModal.classList.add('active-animation'); // アニメーションを活性化
        void capsuleModal.offsetWidth; // 強制リフロー
        capsuleDrawNumber.textContent = `一般質問順序 確定`;
        capsuleDrawName.innerHTML = `<span style="font-size:0.9rem; color:var(--text-muted);">${currentMember} 議員</span><br><span style="color:var(--secondary); font-size:1.4rem;">【第 ${finalRank} 番】</span>`;

        await new Promise(resolve => setTimeout(resolve, 1200));

        capsuleModal.classList.add('closing');
        await new Promise(resolve => setTimeout(resolve, 200));
        capsuleModal.classList.add('hidden');
        capsuleModal.classList.remove('active-animation'); // 次回のためにリセット

        renderQuestionOrderTable();
        setupGachaBalls();
        state.phase2Index++;
        updatePhaseUI();
        showAuditLogs(); // 2回目自動処理中にリアルタイム出力

        // 次の抽選演出に移る前に、ブラウザが描画を完了するためのわずかなディレイを追加 (iOSの連続フリーズ対策)
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      btnSaveResults.classList.remove('hidden'); // 自動引き完了時も保存ボタンを表示
    }

    btnStartDraw.disabled = false;
    btnAutoDraw.disabled = false;
  };

  btnStartDraw.addEventListener('click', handleDrawAction);
  btnAutoDraw.addEventListener('click', handleAutoDrawAction);
  gachaLever.addEventListener('click', handleDrawAction);

  capsuleModal.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  btnSaveResults.addEventListener('click', () => {
    if (state.finalResults.length === 0) return;
    
    // 質問順の昇順ソートでテキストファイル化
    const sorted = [...state.finalResults].sort((a, b) => a.questionRank - b.questionRank);
    const dateStr = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
    
    let textContent = `【一般質問 順序決定結果一覧】\n`;
    textContent += `作成日時: ${dateStr}\n`;
    textContent += `----------------------------\n`;
    sorted.forEach(item => {
      textContent += `${item.questionRank}番： ${item.name} 議員\n`;
    });
    textContent += `----------------------------\n`;
    textContent += `※本データは公平な順番決定システム(fairdraw)によって暗号学的に生成されました。\n`;

    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
    const blob = new Blob([bom, textContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `一般質問順序決定結果-${new Date().toISOString().slice(0,10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  btnCopyLog.addEventListener('click', () => {
    const logBox = document.getElementById('audit-log-text');
    navigator.clipboard.writeText(logBox.textContent)
      .then(() => alert('監査ログをコピーしました！'))
      .catch(err => console.error('コピー失敗:', err));
  });

  btnDownloadLog.addEventListener('click', () => {
    const logBox = document.getElementById('audit-log-text');
    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
    const blob = new Blob([bom, logBox.textContent], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fairdraw-double-audit-log-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
}

function renderDrawOrderTable() {
  resultsDrawOrderBody.innerHTML = '';
  // 番手順（昇順）に並べ替えて表示
  const sorted = [...state.phase1Results].sort((a, b) => a.drawRank - b.drawRank);
  sorted.forEach((item) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${item.drawRank}番手</td>
      <td>${escapeHtml(item.name)}</td>
    `;
    resultsDrawOrderBody.appendChild(tr);
  });
  
  if (state.currentPhase === 1) {
    resultsQuestionOrderBody.innerHTML = `<tr><td colspan="2" style="text-align:center; color:var(--text-muted);">本番くじ引き実行中...</td></tr>`;
  }
}

function renderQuestionOrderTable() {
  resultsQuestionOrderBody.innerHTML = '';
  const sorted = [...state.finalResults].sort((a, b) => a.questionRank - b.questionRank);
  sorted.forEach((item) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${item.questionRank}番</td>
      <td>${escapeHtml(item.name)}</td>
    `;
    resultsQuestionOrderBody.appendChild(tr);
  });
}

function showAuditLogs() {
  const combinedLog = {
    title: '公平な順番決定システム 2段階抽選監査ログ',
    timestamp: new Date().toISOString(),
    phase1_assignedQueue: state.phase1Queue.map(q => `${q.name}(議席:${q.seat || '未設定'})`),
    phase1_poolRandomValues: state.phase1AuditLog,
    phase1_resultsDrawOrder: state.phase1Results,
    phase2_questionDistribution: state.phase2AuditLog,
    phase2_resultsQuestionOrder: state.finalResults
  };

  auditLogText.textContent = JSON.stringify(combinedLog, null, 2);
}

document.addEventListener('DOMContentLoaded', init);
