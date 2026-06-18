/**
 * fairdraw - 公平な順番決定システム
 * 2段階フェーズ式くじ引きに対応 (1回目: くじ順決定 ➔ 2回目: 順番通りに質問順を引く)
 * 議席番号に対応、一括追加UI、各種バグ修正済
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
    title: '公平な順番決定システム 監査ログ (fairdraw Audit Log)',
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

// 与那国町議会 実際の公式議席番号（2025年補選完了後時点）
const DEFAULT_MEMBERS = [
  { id: '1', seat: 1, name: '崎元 俊男', active: true },
  { id: '2', seat: 2, name: '大宜見 浩利', active: true },
  { id: '3', seat: 3, name: '与那原 繁', active: true },
  { id: '4', seat: 4, name: '与那覇 英作', active: true },
  { id: '5', seat: 5, name: '小嶺 博泉', active: true },
  { id: '6', seat: 6, name: '上原 光秀', active: true },
  { id: '7', seat: 7, name: '杉本 英貴', active: true },
  { id: '8', seat: 8, name: '阪口 源太', active: true },
  { id: '9', seat: 9, name: '嵩西 茂則', active: true },
  { id: '10', seat: 10, name: '小島 重喜', active: true }
];

const PRESETS = {
  yonaguni: DEFAULT_MEMBERS,
  empty: []
};

// 状態管理
let state = {
  members: [],
  currentPhase: 1, // 1: くじ引き順決定, 2: 質問順決定
  isDeleteMode: false,

  // フェーズ1データ
  drawOrder: [], // くじを引く順序になった議員名リスト (シャッフルされた順)
  phase1AuditLog: null,

  // フェーズ2データ
  currentDrawIndex: 0,
  questionPool: [],
  finalResults: [],
  phase2AuditLog: null
};

// ==========================================
// 3. UI 制御 & DOM 操作
// ==========================================

let memberListContainer, btnAddMember, btnBatchAdd, btnResetMembers, checkAllMembers;
let totalCountEl, activeCountEl, presetSelect, btnLoadPreset, btnToggleDelete, btnCancelDelete;
let btnStartDraw, btnAutoDraw, resultsPanel, resultsDrawOrderBody, resultsQuestionOrderBody;
let auditLogText, btnCopyLog, btnDownloadLog;
let ballContainer, gachaMachine, gachaLever, capsuleModal, capsuleDrawNumber, capsuleDrawName;
let phaseStatus, lotteryArena, leverInstructionText;

function init() {
  // DOM要素
  memberListContainer = document.getElementById('member-list');
  btnAddMember = document.getElementById('btn-add-member');
  btnBatchAdd = document.getElementById('btn-batch-add');
  btnToggleDelete = document.getElementById('btn-toggle-delete');
  btnCancelDelete = document.getElementById('btn-cancel-delete');
  btnResetMembers = document.getElementById('btn-reset-members');
  checkAllMembers = document.getElementById('check-all-members');
  totalCountEl = document.getElementById('total-count');
  activeCountEl = document.getElementById('active-count');
  presetSelect = document.getElementById('preset-select');
  btnLoadPreset = document.getElementById('btn-load-preset');

  btnStartDraw = document.getElementById('btn-start-draw');
  btnAutoDraw = document.getElementById('btn-auto-draw');
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
      state.members = parsed.members || [...DEFAULT_MEMBERS];
    } catch (e) {
      console.error('State load error:', e);
      state.members = [...DEFAULT_MEMBERS];
    }
  } else {
    state.members = [...DEFAULT_MEMBERS];
  }
  
  state.currentPhase = 1;
  state.isDeleteMode = false;
  state.drawOrder = [];
  state.finalResults = [];
  state.currentDrawIndex = 0;
  resultsPanel.classList.add('hidden');
}

function saveState() {
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
        <input type="number" data-seat-id="${member.id}" value="${member.seat || ''}" min="1" max="99" placeholder="番" ${state.currentPhase === 2 ? 'disabled' : ''}>
      </div>
      <div class="col-check">
        <input type="checkbox" data-id="${member.id}" ${member.active ? 'checked' : ''} ${state.currentPhase === 2 ? 'disabled' : ''}>
      </div>
      <div class="col-name">
        <input type="text" data-id="${member.id}" value="${escapeHtml(member.name)}" placeholder="氏名を入力" ${state.currentPhase === 2 ? 'disabled' : ''}>
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
  if (state.currentPhase === 2) {
    checkAllMembers.disabled = true;
    btnAddMember.disabled = true;
    btnBatchAdd.disabled = true;
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
      btnResetMembers.disabled = true;
      btnLoadPreset.disabled = true;
      presetSelect.disabled = true;
    } else {
      btnCancelDelete.classList.add('hidden');
      btnAddMember.disabled = false;
      btnBatchAdd.disabled = false;
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
  if (state.currentPhase === 2) {
    ballCount = state.questionPool.length;
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
    leverInstructionText.textContent = '1回目: レバーか下のボタンでくじ順を決定！';
    btnStartDraw.textContent = '1. くじを引く順番を決定する';
    btnStartDraw.className = 'btn btn-primary btn-lg btn-glow';
    btnAutoDraw.classList.add('hidden');
  } else {
    phaseStatus.className = 'phase-status-bar phase-2-active';
    lotteryArena.classList.add('phase-2-theme');
    
    if (state.currentDrawIndex < state.drawOrder.length) {
      const nextMember = state.drawOrder[state.currentDrawIndex];
      leverInstructionText.textContent = `次はくじ順 ${state.currentDrawIndex + 1}番： ${nextMember} 議員が引きます`;
      btnStartDraw.textContent = `【${state.currentDrawIndex + 1}番手】${nextMember} 議員のくじを引く`;
      btnStartDraw.className = 'btn btn-primary btn-lg btn-glow';
      
      // 2回目フェーズに入り、かつまだ未完了の議員がいる場合のみ「残りを自動で引く」を表示
      btnAutoDraw.classList.remove('hidden');
    } else {
      leverInstructionText.textContent = 'すべての質問順が決定しました！';
      btnStartDraw.textContent = '抽選完了 (最初からやり直す)';
      btnStartDraw.className = 'btn btn-secondary btn-lg';
      btnAutoDraw.classList.add('hidden');
    }
  }
}

function setupEventListeners() {
  // 1名追加 (名前と議席を入力させるポップアップ)
  btnAddMember.addEventListener('click', () => {
    if (state.currentPhase === 2) return;
    
    const name = prompt('追加する議員の氏名を入力してください:');
    if (name === null) return; // キャンセルされた場合
    const trimmedName = name.trim();
    if (trimmedName === '') {
      alert('氏名が入力されていません。');
      return;
    }

    const defaultSeat = state.members.length + 1;
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

  // 一括追加 (カンマやスペース、改行で区切られた名簿を解析)
  btnBatchAdd.addEventListener('click', () => {
    if (state.currentPhase === 2) return;
    
    const input = prompt(
      '追加したい複数の議員名を「読点（、）」または「スペース」または「改行」で区切って入力してください:\n(例: 久部良太郎、祖納次郎、比川三郎)'
    );
    if (input === null) return;

    // 様々な区切り文字（、, , \n, \t）で分割してトリミング
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

  btnLoadPreset.addEventListener('click', () => {
    if (state.currentPhase === 2) return;
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
        saveState();
        renderMembers();
        setupGachaBalls();
        resultsPanel.classList.add('hidden');
        state.currentPhase = 1;
        updatePhaseUI();
      }
    }
  });

  btnResetMembers.addEventListener('click', () => {
    if (state.currentPhase === 2) return;
    if (state.isDeleteMode) {
      state.isDeleteMode = false;
      btnToggleDelete.textContent = '議員を削除する';
      btnToggleDelete.classList.remove('btn-danger-active');
    }
    if (confirm('議員名簿をデフォルトにリセットしますか？')) {
      state.members = JSON.parse(JSON.stringify(DEFAULT_MEMBERS));
      saveState();
      renderMembers();
      setupGachaBalls();
      resultsPanel.classList.add('hidden');
      state.currentPhase = 1;
      updatePhaseUI();
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
    if (state.currentPhase === 2) return;
    const checked = e.target.checked;
    state.members.forEach(m => m.active = checked);
    saveState();
    renderMembers();
    setupGachaBalls();
  });

  memberListContainer.addEventListener('change', (e) => {
    if (state.currentPhase === 2) return;
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

  // 議席番号・名前の入力変更イベント
  memberListContainer.addEventListener('input', (e) => {
    if (state.currentPhase === 2) return;
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

  // 統合された抽選ハンドラー
  const handleDrawAction = async () => {
    // 参加チェックの入っている議員
    const activeMembers = state.members.filter(m => m.active);
    if (activeMembers.length < 2) {
      alert('抽選には少なくとも2人以上の参加議員が必要です。');
      return;
    }

    if (state.currentPhase === 1) {
      // ==========================================
      // 【フェーズ 1】 くじを引く順番の決定
      // ==========================================
      
      // 1. 議席番号の設定チェックと重複（排他）チェック
      const seatsUsed = [];
      const duplicateSeats = [];
      
      activeMembers.forEach(m => {
        if (m.seat !== null && m.seat !== undefined && m.seat !== '') {
          const seatNum = parseInt(m.seat, 10);
          if (seatsUsed.includes(seatNum)) {
            if (!duplicateSeats.includes(seatNum)) {
              duplicateSeats.push(seatNum);
            }
          } else {
            seatsUsed.push(seatNum);
          }
        }
      });

      // 重複があればエラーダイアログを出して進行をブロックする
      if (duplicateSeats.length > 0) {
        alert(`エラー: 以下の議席番号が重複して登録されています。\n【議席番号: ${duplicateSeats.join(', ')}】\n各議員の議席番号が重複しないように修正してください。`);
        return;
      }

      btnStartDraw.disabled = true;

      // 1-1. 議席番号の有無に応じた順番の決定
      const hasAllSeats = activeMembers.every(m => m.seat !== null && m.seat !== undefined && m.seat !== '');
      let drawOrderNames = [];
      let auditLog = null;

      if (hasAllSeats) {
        // 議席番号順（昇順）で並び替え
        const sorted = [...activeMembers].sort((a, b) => a.seat - b.seat);
        drawOrderNames = sorted.map(m => m.name);
        
        // 議席番号順は固定確定のため、監査ログにその旨を記述
        auditLog = {
          title: '公平な順番決定システム 監査ログ (1回目: 議席順による固定順序決定)',
          timestamp: new Date().toISOString(),
          originalParticipants: activeMembers.map(m => `${m.name}(議席:${m.seat})`),
          shuffledOrder: [...drawOrderNames],
          randomnessEngine: 'None (Sorted by seat number strictly)',
          steps: [],
          verificationCode: btoa(unescape(encodeURIComponent('SeatNumberFixedSelection')))
        };
      } else {
        // 1名でも議席番号設定がない場合は、CSPRNGでランダム順にシャッフル
        const activeNames = activeMembers.map(m => m.name);
        const res = fairShuffle(activeNames);
        drawOrderNames = res.shuffled;
        auditLog = res.auditLog;
      }

      state.drawOrder = drawOrderNames;
      state.phase1AuditLog = auditLog;

      // 1-2. ガチャ回転演出 (1.2秒)
      gachaMachine.classList.add('gacha-spinning');
      await new Promise(resolve => setTimeout(resolve, 1200));
      gachaMachine.classList.remove('gacha-spinning');

      // 1-3. 全員分を0.9秒間隔で自動ポップアップ表示
      for (let i = 0; i < drawOrderNames.length; i++) {
        const name = drawOrderNames[i];
        const drawRank = i + 1;

        capsuleModal.className = 'capsule-modal';
        capsuleDrawNumber.textContent = `くじ順 第 ${drawRank} 順位`;
        capsuleDrawName.textContent = `${name} 議員`;

        await new Promise(resolve => setTimeout(resolve, 900));

        capsuleModal.classList.add('closing');
        await new Promise(resolve => setTimeout(resolve, 200));
        capsuleModal.classList.add('hidden');
      }

      // 1-4. 2回目の本番質問くじプールの準備
      const originalPool = Array.from({ length: activeMembers.length }, (_, idx) => idx + 1);
      const shuffleRes = fairShuffle(originalPool);
      state.questionPool = shuffleRes.shuffled;
      state.phase2AuditLog = shuffleRes.auditLog;
      
      state.currentDrawIndex = 0;
      state.finalResults = [];

      state.currentPhase = 2;
      btnStartDraw.disabled = false;
      
      renderMembers();
      setupGachaBalls();
      updatePhaseUI();
      renderDrawOrderTable();
      resultsPanel.classList.remove('hidden');
      resultsPanel.scrollIntoView({ behavior: 'smooth' });

    } else if (state.currentPhase === 2) {
      // ==========================================
      // 【フェーズ 2】 順番に一般質問順を引く
      // ==========================================
      
      if (state.currentDrawIndex >= state.drawOrder.length) {
        if (confirm('名簿設定に戻り、最初から抽選をやり直しますか？')) {
          state.currentPhase = 1;
          state.drawOrder = [];
          state.finalResults = [];
          state.currentDrawIndex = 0;
          resultsPanel.classList.add('hidden');
          renderMembers();
          setupGachaBalls();
          updatePhaseUI();
        }
        return;
      }

      btnStartDraw.disabled = true;
      const currentMember = state.drawOrder[state.currentDrawIndex];
      
      const finalRank = state.questionPool.pop();
      state.finalResults.push({
        name: currentMember,
        questionRank: finalRank
      });

      gachaMachine.classList.add('gacha-spinning');
      await new Promise(resolve => setTimeout(resolve, 1000));
      gachaMachine.classList.remove('gacha-spinning');

      capsuleModal.className = 'capsule-modal';
      capsuleDrawNumber.textContent = `一般質問順位 確定`;
      capsuleDrawName.innerHTML = `<span style="font-size:0.9rem; color:var(--text-muted);">${currentMember} 議員</span><br><span style="color:var(--secondary); font-size:1.4rem;">【第 ${finalRank} 番】</span>`;

      await new Promise(resolve => setTimeout(resolve, 2200));

      capsuleModal.classList.add('closing');
      await new Promise(resolve => setTimeout(resolve, 200));
      capsuleModal.classList.add('hidden');

      renderQuestionOrderTable();
      setupGachaBalls();

      state.currentDrawIndex++;
      btnStartDraw.disabled = false;
      updatePhaseUI();
      
      if (state.currentDrawIndex >= state.drawOrder.length) {
        showAuditLogs();
      }
    }
  };

  // 残りをすべて自動で引いていく処理 (1人あたり2.4秒)
  const handleAutoDrawAction = async () => {
    if (state.currentPhase !== 2) return;
    
    // 全自動実行中、ボタン類をすべて無効化
    btnStartDraw.disabled = true;
    btnAutoDraw.disabled = true;

    while (state.currentDrawIndex < state.drawOrder.length) {
      const currentMember = state.drawOrder[state.currentDrawIndex];
      const finalRank = state.questionPool.pop();
      
      state.finalResults.push({
        name: currentMember,
        questionRank: finalRank
      });

      // ガチャ回転演出
      gachaMachine.classList.add('gacha-spinning');
      await new Promise(resolve => setTimeout(resolve, 900));
      gachaMachine.classList.remove('gacha-spinning');

      // 結果カプセル表示
      capsuleModal.className = 'capsule-modal';
      capsuleDrawNumber.textContent = `一般質問順位 確定`;
      capsuleDrawName.innerHTML = `<span style="font-size:0.9rem; color:var(--text-muted);">${currentMember} 議員</span><br><span style="color:var(--secondary); font-size:1.4rem;">【第 ${finalRank} 番】</span>`;

      // 1.2秒間開示
      await new Promise(resolve => setTimeout(resolve, 1200));

      // 閉じる演出 (0.2秒)
      capsuleModal.classList.add('closing');
      await new Promise(resolve => setTimeout(resolve, 200));
      capsuleModal.classList.add('hidden');

      // テーブルとボール状態の更新
      renderQuestionOrderTable();
      setupGachaBalls();

      state.currentDrawIndex++;
      updatePhaseUI();
    }

    btnStartDraw.disabled = false;
    btnAutoDraw.disabled = false;
    showAuditLogs();
  };

  btnStartDraw.addEventListener('click', handleDrawAction);
  btnAutoDraw.addEventListener('click', handleAutoDrawAction);
  gachaLever.addEventListener('click', handleDrawAction);

  capsuleModal.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  btnCopyLog.addEventListener('click', () => {
    const logBox = document.getElementById('audit-log-text');
    navigator.clipboard.writeText(logBox.textContent)
      .then(() => alert('監査ログをコピーしました！'))
      .catch(err => console.error('コピー失敗:', err));
  });

  btnDownloadLog.addEventListener('click', () => {
    const logBox = document.getElementById('audit-log-text');
    const blob = new Blob([logBox.textContent], { type: 'application/json' });
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
  state.drawOrder.forEach((name, index) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${index + 1}番手</td>
      <td>${escapeHtml(name)}</td>
    `;
    resultsDrawOrderBody.appendChild(tr);
  });
  
  resultsQuestionOrderBody.innerHTML = `<tr><td colspan="2" style="text-align:center; color:var(--text-muted);">本番くじ引き実行中...</td></tr>`;
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
    phase1_drawOrder: state.phase1AuditLog,
    phase2_questionDistribution: state.phase2AuditLog,
    finalReport: state.finalResults.map(r => ({
      name: r.name,
      questionRank: r.questionRank
    }))
  };

  auditLogText.textContent = JSON.stringify(combinedLog, null, 2);
}

document.addEventListener('DOMContentLoaded', init);
