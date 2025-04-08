'use client';

import { Box, Center, Loader, Text } from '@mantine/core';
import { useEffect, useRef, useState } from 'react';

const IMAGE_API_URL = '/api/photo_slide/';
const REFRESH_INTERVAL_MS = 30 * 1000;
const FETCH_TIMEOUT_MS = 10000;

export default function WeddingPage() {
  // 現在表示している画像のBlob URLを保持するstate
  // Blob URLはメモリリークを防ぐために適切に解放する必要がある
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  // 画像取得や表示に関するエラーメッセージを保持するstate
  const [error, setError] = useState<string | null>(null);
  // 初回ロードや画像切り替え時のローディング状態を保持するstate
  const [isLoading, setIsLoading] = useState<boolean>(true);
  // 直前に生成したBlob URLを保持するためのref (クリーンアップ用)
  // stateだと更新タイミングの問題で古いURLを解放できない可能性があるためrefを使用
  const previousImageUrlRef = useRef<string | null>(null);
  // fetchを中断するためのAbortControllerのref
  const abortControllerRef = useRef<AbortController | null>(null);

  // 画像を取得し、Blob URLを生成・設定する非同期関数
  const fetchAndSetImage = async () => {
    // console.log('Fetching new image...'); // デバッグ用ログ

    // 既存のfetchがあれば中断する
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    // 新しいAbortControllerを作成
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    // 画像切り替え時にも一時的にローディング表示 (任意)
    // setIsLoading(true);
    // エラー状態をリセット (新しい画像取得試行時にクリア)
    // setError(null); // 必要に応じてコメント解除

    try {
      const response = await fetch(IMAGE_API_URL, {
        method: 'GET',
        cache: 'no-store', // キャッシュを利用せず常に新しいデータを取得
        signal: signal // AbortSignalを設定
      });

      // AbortSignalによる中断をチェック (fetch自体はエラーを投げない場合がある)
      if (signal.aborted) {
        console.log('Fetch aborted');
        return; // 中断された場合は何もしない
      }

      if (!response.ok) {
        throw new Error(`画像の取得に失敗しました。ステータス: ${response.status}`);
      }

      // レスポンスボディをBlobとして取得
      const blob = await response.blob();

      // BlobのMIMEタイプが画像形式か簡易チェック (任意)
      if (!blob.type.startsWith('image/')) {
        console.warn(`取得したデータのMIMEタイプが画像ではありません: ${blob.type}`);
        // 必要であればエラー処理を追加
      }

      // 前回のBlob URLが存在すれば、メモリリークを防ぐために解放する
      if (previousImageUrlRef.current) {
        URL.revokeObjectURL(previousImageUrlRef.current);
        // console.log('Revoked previous URL:', previousImageUrlRef.current); // デバッグ用ログ
      }

      // Blobから新しいBlob URLを生成
      const newImageUrl = URL.createObjectURL(blob);
      // console.log('Created new URL:', newImageUrl); // デバッグ用ログ

      // stateを更新して新しい画像を表示
      setImageUrl(newImageUrl);
      // 生成したURLをrefにも保存し、次回の解放に備える
      previousImageUrlRef.current = newImageUrl;
      setError(null); // 成功したのでエラーメッセージをクリア
      setIsLoading(false); // ローディング完了
    } catch (err: unknown) {
      // AbortErrorは意図した中断なので無視
      if (err instanceof Error && err.name === 'AbortError') {
        console.log('Fetch intentionally aborted.');
        return;
      }

      console.error('画像取得または処理中にエラーが発生しました:', err);
      let errorMessage = '不明なエラーが発生しました。';
      if (err instanceof Error) {
        errorMessage = err.message;
      }
      // エラーメッセージにタイムスタンプを追加して、同じエラーが連続しても変化がわかるようにする
      setError(`画像表示エラー: ${errorMessage} (${new Date().toLocaleTimeString()})`);
      setIsLoading(false); // エラーが発生してもローディングは解除
      // エラー発生時、前の画像を表示し続けるか、何も表示しないかは選択可能
      // ここではエラーメッセージを表示し、画像は前のものが残っていれば表示される
    } finally {
      // AbortControllerの参照をクリア
      if (abortControllerRef.current?.signal === signal) {
        abortControllerRef.current = null;
      }
    }
  };

  // コンポーネントのマウント時とアンマウント時の副作用を管理
  useEffect(() => {
    // --- マウント時の処理 ---
    // console.log('Component mounted. Starting initial fetch and interval.'); // デバッグ用ログ

    // タイムアウト付きで初回画像取得を実行
    const initialFetchTimeout = setTimeout(() => {
      if (isLoading) {
        // まだローディング中ならタイムアウト処理
        console.error('Initial fetch timed out.');
        setError(`画像の初回取得がタイムアウトしました (${FETCH_TIMEOUT_MS / 1000}秒)`);
        setIsLoading(false);
        if (abortControllerRef.current) {
          abortControllerRef.current.abort(); // 進行中のfetchを中断
        }
      }
    }, FETCH_TIMEOUT_MS);

    fetchAndSetImage().finally(() => {
      clearTimeout(initialFetchTimeout); // fetchが完了したらタイムアウトをクリア
    });

    // REFRESH_INTERVAL_MS ごとに画像を取得するタイマーを設定
    const intervalId = setInterval(() => {
      // タイムアウト付きで画像取得を実行
      const fetchTimeout = setTimeout(() => {
        console.error(`Fetch timed out after ${FETCH_TIMEOUT_MS / 1000} seconds.`);
        setError(`画像の取得がタイムアウトしました (${new Date().toLocaleTimeString()})`);
        if (abortControllerRef.current) {
          abortControllerRef.current.abort(); // 進行中のfetchを中断
        }
      }, FETCH_TIMEOUT_MS);

      fetchAndSetImage().finally(() => {
        clearTimeout(fetchTimeout); // fetchが完了したらタイムアウトをクリア
      });
    }, REFRESH_INTERVAL_MS);

    // --- アンマウント時のクリーンアップ処理 ---
    return () => {
      // console.log('Component unmounting. Cleaning up...'); // デバッグ用ログ
      clearInterval(intervalId); // タイマーをクリア
      clearTimeout(initialFetchTimeout); // 念のため初回タイムアウトもクリア

      // 進行中のfetchがあれば中断
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }

      // 最後に保持していたBlob URLを解放
      if (previousImageUrlRef.current) {
        URL.revokeObjectURL(previousImageUrlRef.current);
        // console.log('Revoked final URL on unmount:', previousImageUrlRef.current); // デバッグ用ログ
        previousImageUrlRef.current = null;
      }
    };
  }, []); // 空の依存配列により、このuseEffectはマウント時に1回だけ実行され、アンマウント時にクリーンアップされる

  // レンダリング
  return (
    <Box
      style={{
        width: '100vw', // ビューポート幅全体
        height: '100vh', // ビューポート高さ全体
        backgroundColor: 'black', // 背景色を黒に設定
        display: 'flex', // Flexboxを使用して中央揃えを実現
        justifyContent: 'center', // 水平方向の中央揃え
        alignItems: 'center', // 垂直方向の中央揃え
        overflow: 'hidden' // コンテンツがはみ出た場合に隠す
      }}
    >
      {/* ローディング状態の表示 */}
      {isLoading && (
        <Center style={{ flexDirection: 'column', color: 'white' }}>
          <Loader color='white' size='lg' />
          <Text mt='md'>画像を読み込んでいます...</Text>
        </Center>
      )}

      {/* エラー状態の表示 (ローディング中でない場合) */}
      {!isLoading && error && (
        <Center style={{ padding: '20px', color: 'red', textAlign: 'center', maxWidth: '80%' }}>
          <Text size='lg'>{error}</Text>
        </Center>
      )}

      {/* 画像の表示 (ローディング中でなく、エラーがなく、画像URLが存在する場合) */}
      {!isLoading && !error && imageUrl && (
        <img
          key={imageUrl} // URLが変わるたびにimg要素を確実に再レンダリングさせる（キャッシュ対策や意図しない挙動の防止）
          src={imageUrl}
          alt='ウェディング スライドショー'
          style={{
            display: 'block', // img要素下の余分なスペースを防ぐ
            maxWidth: '100%', // 親要素の幅を超えないようにする
            maxHeight: '100vh', // 親要素の高さ（ビューポートの高さ）を超えないようにする
            objectFit: 'contain', // アスペクト比を維持したまま、要素全体がコンテナに収まるように調整
            objectPosition: 'center center', // 画像を中央に配置
            // パフォーマンス向上のためのヒント (ブラウザ依存)
            imageRendering: 'auto' // or 'pixelated' or 'crisp-edges' depending on desired effect for scaling
          }}
          // img要素自体の読み込みエラーハンドリング (ネットワークエラー以外でBlob URLが無効になった場合など)
          onError={(e) => {
            console.error('img要素での画像読み込みエラー:', imageUrl, e);
            setError(
              `画像の表示に失敗しました。URLが無効か破損している可能性があります。(${new Date().toLocaleTimeString()})`
            );
            // エラーが発生した場合、現在のimageUrlをクリアするなどの対策も可能
            setImageUrl(null);
            if (previousImageUrlRef.current === imageUrl) {
              previousImageUrlRef.current = null; // 解放済みとして扱う
            }
          }}
        />
      )}
    </Box>
  );
}
