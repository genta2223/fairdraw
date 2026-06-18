import { fairShuffle, getRandomUint32 } from './core.js';
import assert from 'assert';

console.log('--- fairdraw-core 単体テスト開始 ---');

// 1. CSPRNG の基本動作テスト
try {
  const num = getRandomUint32();
  assert.strictEqual(typeof num, 'number');
  assert.ok(num >= 0 && num <= 4294967295);
  console.log('✓ テスト 1: CSPRNGが正常な無符号32bit整数を生成しました。の値:', num);
} catch (e) {
  console.error('✗ テスト 1 失敗:', e);
  process.exit(1);
}

// 2. シャッフル関数の動作テスト
try {
  const original = ['議員A', '議員B', '議員C', '議員D', '議員E'];
  const { shuffled, auditLog } = fairShuffle(original);
  
  assert.strictEqual(shuffled.length, original.length);
  // 要素がすべて揃っているか確認
  for (const item of original) {
    assert.ok(shuffled.includes(item));
  }
  
  // 監査ログの検証
  assert.ok(auditLog.timestamp);
  assert.strictEqual(auditLog.steps.length, original.length - 1);
  assert.ok(auditLog.verificationCode);
  
  console.log('✓ テスト 2: シャッフルと監査ログの生成に成功しました。');
  console.log('監査ログ例 (一部):', JSON.stringify(auditLog, null, 2).substring(0, 300) + '...\n');
} catch (e) {
  console.error('✗ テスト 2 失敗:', e);
  process.exit(1);
}

// 3. 多回数実行による統計的偏り検証（シミュレーション）
try {
  const original = [0, 1, 2];
  const positionCounts = [
    [0, 0, 0], // 要素0が各インデックスに配置された回数
    [0, 0, 0], // 要素1
    [0, 0, 0]  // 要素2
  ];
  
  const iterations = 30000;
  for (let i = 0; i < iterations; i++) {
    const { shuffled } = fairShuffle(original);
    for (let pos = 0; pos < shuffled.length; pos++) {
      const val = shuffled[pos];
      positionCounts[val][pos]++;
    }
  }
  
  console.log(`✓ テスト 3: 3要素の配列を ${iterations} 回シャッフルして分布を検証中...`);
  const expectedMean = iterations / 3;
  const tolerance = expectedMean * 0.05; // 5% の許容誤差
  
  for (let val = 0; val < 3; val++) {
    for (let pos = 0; pos < 3; pos++) {
      const count = positionCounts[val][pos];
      const diff = Math.abs(count - expectedMean);
      console.log(`  値 ${val} が位置 ${pos} に配置された回数: ${count} (期待値: ${expectedMean.toFixed(0)})`);
      assert.ok(diff < tolerance, `分布の偏りが許容値を超えています: 値${val}が位置${pos}で${count}回出現`);
    }
  }
  console.log('✓ テスト 3: 各要素が各位置にほぼ均等に配置されており、公平性が確認されました。');
} catch (e) {
  console.error('✗ テスト 3 失敗:', e);
  process.exit(1);
}

console.log('--- すべてのテストに合格しました！ ---');
