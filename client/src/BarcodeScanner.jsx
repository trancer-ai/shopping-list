import React, { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';

export default function BarcodeScanner({ onDetected, onCancel }) {
  const videoRef = useRef(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const reader = new BrowserMultiFormatReader();
    let controls = null;
    let detected = false;

    reader
      .decodeFromConstraints(
        { video: { facingMode: 'environment' } },
        videoRef.current,
        (result) => {
          if (detected || !result) return;
          detected = true;
          controls?.stop();
          onDetected(result.getText());
        }
      )
      .then((c) => {
        controls = c;
        if (detected) controls.stop(); // detected before the promise resolved
      })
      .catch(() => {
        setError('Camera access is needed to scan — you can still add items manually.');
      });

    return () => {
      detected = true;
      controls?.stop();
    };
  }, [onDetected]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: '#000',
        zIndex: 2000,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      {error ? (
        <p style={{ color: '#fff', padding: 24, textAlign: 'center' }}>{error}</p>
      ) : (
        <video ref={videoRef} style={{ maxWidth: '100%', maxHeight: '80%' }} muted playsInline />
      )}
      <button onClick={onCancel} style={{ marginTop: 16 }}>Cancel</button>
    </div>
  );
}
