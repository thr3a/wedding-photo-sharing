import fsSync from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as line from '@line/bot-sdk';
import { NextResponse } from 'next/server';

const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || 'dummy',
  channelSecret: process.env.LINE_CHANNEL_SECRET || 'dummy'
};

// export const UPLOAD_DIR_BASE = process.cwd();
export const UPLOAD_DIR_BASE = '/tmp/uploads';
const UPLOAD_DIR = path.join(UPLOAD_DIR_BASE, 'before');

const client = new line.Client(lineConfig);

function generateRandomString(length: number): string {
  return Math.random()
    .toString(36)
    .substring(2, 2 + length);
}

function formatDate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0'); // 月は0から始まるため+1
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${yyyy}${mm}${dd}-${hh}${min}`;
}

async function saveImage(messageId: string): Promise<string | null> {
  try {
    console.log(`メッセージID ${messageId} のコンテンツ取得を試行中...`);
    // getMessageContent は ReadableStream を返す
    const contentStream: Readable = await client.getMessageContent(messageId);

    await fsPromises.mkdir(UPLOAD_DIR, { recursive: true });

    const timestamp = formatDate(new Date());
    const randomStr = generateRandomString(6);
    const filename = `${timestamp}-${randomStr}.jpg`;
    const filePath = path.join(UPLOAD_DIR, filename);

    const fileWriteStream = fsSync.createWriteStream(filePath);

    await pipeline(contentStream, fileWriteStream);

    return filePath;
  } catch (error: any) {
    console.error(`メッセージID ${messageId} の画像保存中にエラーが発生しました:`, error.message || error);
    if (error.originalError) {
      console.error('元のエラー:', error.originalError);
    }
    if (error instanceof line.HTTPError) {
      console.error('LINE API エラーステータス:', error.statusCode);
      console.error('LINE API エラーボディ:', error.originalError?.response?.data);
    }
    return null;
  }
}

export async function POST(request: Request) {
  // 1. 署名検証 (セキュリティ上非常に重要)
  const signature = request.headers.get('x-line-signature');
  if (!signature) {
    console.error('署名がありません');
    return NextResponse.json({ message: 'Bad Request: 署名がありません' }, { status: 400 });
  }

  const bodyText = await request.text();

  if (!line.validateSignature(bodyText, lineConfig.channelSecret, signature)) {
    console.error('無効な署名');
    return NextResponse.json({ message: 'Unauthorized: 無効な署名です' }, { status: 401 });
  }

  // 2. 検証済みボディのパース
  let events: line.WebhookEvent[];
  try {
    const body = JSON.parse(bodyText);
    events = body.events;
  } catch (error) {
    console.error('リクエストボディのパースに失敗しました:', error);
    return NextResponse.json({ message: 'Bad Request: 無効なJSONです' }, { status: 400 });
  }

  // 3. イベント処理
  if (!events || events.length === 0) {
    console.log('ペイロードにイベントが見つかりません');
    return NextResponse.json({ success: true, message: '処理するイベントがありません' }, { status: 200 });
  }

  try {
    for (const event of events) {
      // メッセージイベント、かつ返信可能なトークンがある場合のみ処理
      if (event.type !== 'message' || !event.replyToken) {
        continue;
      }

      const message = event.message;
      const replyToken = event.replyToken;
      let replyText = ''; // ユーザーに返信するテキスト

      console.log(`メッセージタイプ ${message.type} をユーザー ${event.source.userId} から処理中`);

      switch (message.type) {
        case 'text': {
          replyText = '結婚式の画像を送信すると、プロジェクターにその画像が映し出されます！';
          await client.replyMessage(replyToken, { type: 'text', text: replyText });
          console.log(`テキストメッセージに返信しました: "${replyText}"`);
          break;
        }

        case 'image': {
          let savedPath: string | null = null;
          let shouldProcess = true; // この画像を処理すべきかどうかのフラグ
          let imageIndex = 1; // 画像のインデックス (単一画像の場合は1)
          let imageSetId: string | undefined; // 画像セットID
          let totalImagesInSet = 1; // セット内の総画像数 (単一画像の場合は1)

          if ('imageSet' in message && message.imageSet) {
            imageSetId = message.imageSet.id;
            imageIndex = message.imageSet.index;
            totalImagesInSet = message.imageSet.total;
            console.log(`画像セット ${imageSetId} の ${imageIndex}/${totalImagesInSet} 番目を処理中`);
            // 5枚目以降は処理しない
            if (imageIndex > 4) {
              console.log(`画像セット ${imageSetId} の ${imageIndex} 番目は上限(4枚)を超えたためスキップします。`);
              shouldProcess = false;
            }
          } else {
            console.log('単一画像を処理中');
          }

          // 処理すべき画像の場合のみ保存を実行
          if (shouldProcess) {
            savedPath = await saveImage(message.id);
          }

          // 返信が必要かどうかを判断
          let shouldReply = false;
          // 処理対象の最後の画像かどうかの判定
          // - 単一画像の場合: 常に返信
          // - 画像セットの場合:
          //   - 総数が4枚以下なら、最後の画像 (index === total) を受信したとき
          //   - 総数が5枚以上なら、4枚目の画像 (index === 4) を受信したとき
          const isLastProcessedImage = imageIndex === Math.min(totalImagesInSet, 4);

          if (shouldProcess && isLastProcessedImage) {
            shouldReply = true;
            if (imageSetId) {
              console.log(`画像セット ${imageSetId} の処理対象(${Math.min(totalImagesInSet, 4)}枚)の最後の画像(${imageIndex}番目)を受信。返信を試みます。`);
            } else {
              console.log('単一画像の処理完了。返信を試みます。');
            }
          }

          if (shouldReply) {
            if (savedPath) {
              // 最後の処理対象画像の保存が成功した場合
              replyText = 'ありがとうございます！画像を受け取りました！';
              await client.replyMessage(replyToken, { type: 'text', text: replyText });
            } else {
              replyText = '画像の処理中にエラーが発生しました😭';
              await client.replyMessage(replyToken, { type: 'text', text: replyText });
              console.error(`メッセージID ${message.id} (処理対象の最後の画像) の保存に失敗しました。エラーメッセージを返信します。`);
            }
          } else if (shouldProcess && !savedPath) {
            // 中間画像 (1枚目から3枚目) の保存に失敗した場合のログ
            console.error(`メッセージID ${message.id} (画像セットの${imageIndex}番目) の中間画像の保存に失敗しました。まだ返信は送信されません。`);
          }
          break;
        }

        // その他のメッセージタイプ (スタンプ、動画、音声、位置情報など)
        default: {
          console.log(`未対応のメッセージタイプを無視: ${message.type}`);
          replyText = '対応していない形式です。結婚式の画像を送信すると、プロジェクターにその画像が映し出されます！';
          await client.replyMessage(replyToken, { type: 'text', text: replyText });
          break;
        }
      }
    }

    // 4. LINEプラットフォームへの成功応答
    // LINEはWebhook受信後、迅速に200 OKを期待します。
    // ユーザーへの返信は replyMessage API を介して非同期に行われます。
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error: any) {
    // イベント処理ループ全体で予期せぬエラーが発生した場合
    console.error('Webhookイベント処理中に予期せぬエラーが発生しました:', error.message || error);
    if (error.originalError) {
      console.error('元のエラー:', error.originalError);
    }
    if (error instanceof line.HTTPError) {
      console.error('LINE API エラーステータス:', error.statusCode);
      console.error('LINE API エラーボディ:', error.originalError?.response?.data);
    }

    return NextResponse.json({ message: 'Internal Server Error' }, { status: 500 });
  }
}

export async function GET() {
  // ヘルスチェックや疎通確認用のエンドポイント
  return NextResponse.json({ status: 'ok', message: 'LINE Bot webhook はアクティブです。' }, { status: 200 });
}
