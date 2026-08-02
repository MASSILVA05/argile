const MAX_WIDTH = 800
const JPEG_QUALITY = 0.6

export function compressImage(file, { maxWidth = MAX_WIDTH, quality = JPEG_QUALITY } = {}) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()

    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, maxWidth / img.width)
      const width = Math.round(img.width * scale)
      const height = Math.round(img.height * scale)

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d').drawImage(img, 0, 0, width, height)

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Échec de la compression de la photo'))
            return
          }
          const name = file.name.replace(/\.\w+$/, '') + '.jpg'
          resolve(new File([blob], name, { type: 'image/jpeg' }))
        },
        'image/jpeg',
        quality
      )
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Impossible de lire la photo'))
    }
    img.src = url
  })
}
