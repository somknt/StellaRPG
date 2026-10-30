// オンラインのアカウント（PC とスマホで同じアカウントを使う）の設定
//
// Supabase（無料のデータベースのサービス）のプロジェクトを作り、online/README.md の手順で準備したら、下の2つを書き入れる
//   url：Project URL（例 https://abcdefghijklmnop.supabase.co）
//   key：Publishable key（sb_publishable_ で始まる）または anon public key（eyJ で始まる）
//        どちらも「公開してよい鍵」なので、ここに書いてよい（secret key・service_role key は絶対に書かない）
//
// 2つとも空の間は、アカウントはこの端末（ブラウザ）だけに保存される（ほかの端末からはログインできない）
window.ONLINE_CONFIG = {
    url: '',
    key: ''
};
