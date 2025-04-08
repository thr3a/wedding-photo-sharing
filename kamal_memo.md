```sh
❯ kamal init
Created configuration file in config/deploy.yml
Created .kamal/secrets file
Created sample hooks in .kamal/hooks
```

Kamal を使用して何かをデプロイするには、 /upヘルスチェック ルート (成功した200ステータス コードを返す単純なエンドポイント)を使用してポート80でアプリケーション サーバーを実行する Dockerfile が必要です。

