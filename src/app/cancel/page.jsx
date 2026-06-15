import Link from 'next/link'

export default function CancelPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-5">
      <div className="bg-white rounded-2xl p-10 max-w-md w-full shadow-lg text-center">
        <div className="w-20 h-20 bg-red-500 rounded-full mx-auto mb-6 flex items-center justify-center text-4xl text-white">
          ✕
        </div>

        <h1 className="text-3xl font-bold mb-3 text-red-500">
          Pago Cancelado
        </h1>
        
        <p className="text-gray-500 mb-6 leading-relaxed">
          El proceso de pago fue cancelado. No se ha realizado ningún cargo.
        </p>

        <Link 
          href="/" 
          className="inline-block py-3.5 px-7 text-base font-semibold text-white bg-red-500 rounded-xl hover:bg-red-600 transition-colors"
        >
          Intentar de nuevo
        </Link>
      </div>
    </main>
  )
}