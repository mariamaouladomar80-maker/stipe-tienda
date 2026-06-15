import Link from 'next/link'

export default function SuccessPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-5">
      <div className="bg-white rounded-2xl p-10 max-w-md w-full shadow-lg text-center">
        <div className="w-20 h-20 bg-green-500 rounded-full mx-auto mb-6 flex items-center justify-center text-4xl text-white">
          ✓
        </div>

        <h1 className="text-3xl font-bold mb-3 text-green-500">
          ¡Pago Completado!
        </h1>
        
        <p className="text-gray-500 mb-6 leading-relaxed">
          Gracias por tu compra. Recibirás el acceso al producto en tu email.
        </p>

        <Link 
          href="/" 
          className="inline-block py-3.5 px-7 text-base font-semibold text-white bg-green-500 rounded-xl hover:bg-green-600 transition-colors"
        >
          Volver a la tienda
        </Link>
      </div>
    </main>
  )
}