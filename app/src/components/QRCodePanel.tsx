import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

export default function QRCodePanel() {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const url = window.location.origin

  useEffect(() => {
    QRCode.toDataURL(url, { width: 220, margin: 1, color: { dark: '#0ff5e0', light: '#141126' } })
      .then(setDataUrl)
      .catch(() => setDataUrl(null))
  }, [url])

  return (
    <div className="panel text-center">
      <h3 className="mb-2 text-sm font-bold text-arcade-cyan">📱 Scan to join on your phone</h3>
      {dataUrl && <img src={dataUrl} alt="QR code" className="mx-auto rounded-lg" />}
      <div className="mt-2 break-all text-xs text-gray-500">{url}</div>
    </div>
  )
}
