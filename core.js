/**
 * fairdraw-core
 * 暗号学的乱数 (CSPRNG) を用いた公平・安全な順番決定ロジック
 */

/**
 * CSPRNG (Web Crypto API) を用いて 32ビットの無符号整数を取得する
 * Node.js 環境（テスト実行時）とブラウザ環境の両方で動作するように調整
 * @returns {number} 0 から 4294967295 までのランダムな整数
 */
export function getRandomUint32() {
  if (typeof window !== 'undefined' && window.crypto) {
    const array = new Uint32Array(1);
    window.crypto.getRandomValues(array);
    return array[0];
  } else if (typeof global !== 'undefined' && (global.crypto || crypto)) {
    // Node.js 環境用フォールバック
    const nodeCrypto = global.crypto || require('crypto');
    const array = new Uint32Array(1);
    nodeCrypto.getRandomValues(array);
    return array[0];
  } else {
    throw new Error('暗号学的乱数生成器 (CSPRNG) が利用できません。');
  }
}

/**
 * 与えられた配列を Fisher-Yates アルゴリズムと CSPRNG を用いてシャッフルする。
 * 同時に、検証・監査のための詳細なログデータを生成する。
 * 
 * @param {Array<any>} array シャッフル対象の配列 (破壊的変更を防ぐため、内部でコピーを作成)
 * @returns {{ shuffled: Array<any>, auditLog: object }} シャッフル後の配列と監査用ログ
 */
export function fairShuffle(array) {
  const items = [...array];
  const n = items.length;
  const rawRandomValues = []; // 監査ログ用の生乱数記録
  
  // Fisher-Yates Shuffle
  for (let i = n - 1; i > 0; i--) {
    const randUint32 = getRandomUint32();
    // 剰余による偏り（Modulo Bias）を極力防ぐため、範囲内で均等なランダムインデックスを取得
    const maxVal = 4294967296 - (4294967296 % (i + 1));
    let rand = randUint32;
    while (rand >= maxVal) {
      rand = getRandomUint32();
    }
    const j = rand % (i + 1);
    
    // ログ記録
    rawRandomValues.push({
      step: n - i,
      targetRange: `0 to ${i}`,
      chosenIndex: j,
      rawUint32: randUint32
    });
    
    // スワップ
    const temp = items[i];
    items[i] = items[j];
    items[j] = temp;
  }

  const timestamp = new Date().toISOString();
  
  // 監査ログオブジェクトの構築
  const auditLog = {
    title: '公平な順番決定システム 監査ログ (fairdraw Audit Log)',
    timestamp: timestamp,
    originalParticipants: [...array],
    shuffledOrder: [...items],
    randomnessEngine: typeof window !== 'undefined' ? 'Web Crypto API (window.crypto)' : 'Node.js Crypto Module',
    steps: rawRandomValues,
    verificationCode: btoa(unescape(encodeURIComponent(JSON.stringify({ timestamp, originalParticipants: array, shuffledOrder: items, rawRandomValues }))))
  };

  return {
    shuffled: items,
    auditLog: auditLog
  };
}
