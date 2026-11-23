window.SURVEY_CONFIG = {
  // Apps Script をウェブアプリとしてデプロイしたときの URL(https://script.google.com/macros/s/…/exec)。
  // 空のままだとデモモード(架空の回答とこのブラウザ内の回答だけで動く)になる。
  API_URL: 'https://script.google.com/macros/s/AKfycbx32vPtSDWsiWsDssMWuvR01rAvZolFoBZAE_aoH7QO3cdYQBgWgYocEGZNQ0fLlF3_qg/exec',

  // 送信に必要な希望の最小数。gas/Code.gs の MIN_CHOICES と揃えること。
  MIN_CHOICES: 3,

  // 結果画面で、他の人のデータを「押している(カーソルを合わせている)間だけ」表示する。
  HOLD_TO_REVEAL: true,

  // 学年全体の GPA 分布。回答していない人を含めた順位や志望者数の推定に使う。
  // pct は 0.5 刻みの割合(%):0〜0.5, 0.5〜1.0, …, 3.0〜3.5, 3.5〜4.0(4.0 を含む)
  COHORT: {
    label: '学科全体(2024年度入学生)',
    size: 170,
    pct: [0, 2.7, 6.6, 18, 24.6, 27.3, 14.8, 6.0],
  },
};
