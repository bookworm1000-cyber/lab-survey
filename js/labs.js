// 研究室一覧。min / max は定員の目安。id は保存データに使うので、公開後は変更しないこと。
window.LAB_AREAS = [
  { id: 'ee', name: '電気工学', labs: [
    { id: 'ee-machine', name: '電気機器', prof: '大橋・近藤', min: 8, max: 10 },
    { id: 'ee-apply', name: '電気応用システム', prof: '濱田', min: 6, max: 8 },
    { id: 'ee-em', name: '情報電磁気学', prof: '米津', min: 6, max: 8 },
  ]},
  { id: 'md', name: '機能性材料・デバイス', labs: [
    { id: 'md-wave', name: '波動情報工学', prof: '北村', min: 6, max: 8 },
    { id: 'md-microwave', name: '超高周波工学', prof: '佐伯・大澤', min: 8, max: 10 },
    { id: 'md-device', name: '電子デバイス工学', prof: '佐藤', min: 6, max: 8 },
    { id: 'md-quantum', name: '量子機能性理論', prof: '杉本', min: 6, max: 8 },
    { id: 'md-measure', name: '計測物性工学', prof: '宝田', min: 6, max: 8 },
  ]},
  { id: 'ic', name: '情報通信工学', labs: [
    { id: 'ic-netdesign', name: 'ネットワークデザイン', prof: '平田', min: 6, max: 8 },
    { id: 'ic-comm', name: '情報通信工学', prof: '山本・速水', min: 8, max: 10 },
    { id: 'ic-wireless', name: 'ワイヤレスネットワーキング', prof: '四方', min: 6, max: 8 },
    { id: 'ic-network', name: '情報ネットワーク', prof: '和田', min: 6, max: 8 },
  ]},
  { id: 'si', name: 'システム情報学', labs: [
    { id: 'si-dynamics', name: 'ダイナミクスコンピューティング', prof: '伊藤', min: 6, max: 8 },
    { id: 'si-circuit', name: '情報回路システム', prof: '肥川', min: 6, max: 8 },
    { id: 'si-math', name: '情報数理工学', prof: '三好・権', min: 8, max: 10 },
    { id: 'si-control', name: 'システム制御工学', prof: '本仲', min: 6, max: 8 },
  ]},
  { id: 'mp', name: 'メディア処理工学', labs: [
    { id: 'mp-sound', name: '音情報システム', prof: '梶川・豊岡', min: 8, max: 10 },
    { id: 'mp-bio', name: '生体情報処理', prof: '東', min: 6, max: 8 },
    { id: 'mp-optics', name: '光情報システム', prof: '松島・西', min: 8, max: 10 },
    { id: 'mp-media', name: '知能メディア', prof: '吉田', min: 6, max: 8 },
  ]},
  { id: 'is', name: '知能ソフトウェア工学', labs: [
    { id: 'is-agent', name: '身体性エージェント', prof: 'アイエドゥン', min: 6, max: 8 },
    { id: 'is-km', name: '知識情報システム(知識モデリングG)', prof: '小尻', min: 6, max: 8 },
    { id: 'is-or', name: '知識情報システム(オペレーションズ・リサーチG)', prof: '中村', min: 6, max: 8 },
    { id: 'is-kansei', name: '感性情報システム', prof: '徳丸', min: 6, max: 8 },
    { id: 'is-computer', name: '計算機システム工学', prof: '花田', min: 6, max: 8 },
  ]},
  { id: 'ge', name: 'グリーンエレクトロニクス工学科', labs: [
    { id: 'ge-material', name: '電子材料応用', prof: '稲葉', min: 2, max: 2 },
    { id: 'ge-power', name: 'パワー半導体工学', prof: '上田', min: 2, max: 2 },
    { id: 'ge-process', name: '電子機能材料プロセス', prof: '大堀', min: 2, max: 2 },
    { id: 'ge-energy', name: '環境・エネルギー材料工学', prof: '黒川', min: 2, max: 2 },
    { id: 'ge-ic', name: '集積回路', prof: '土谷', min: 2, max: 2 },
    { id: 'ge-nano', name: 'グリーンナノファブリケーション', prof: '長谷川', min: 2, max: 2 },
  ]},
];
