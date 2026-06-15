'use client'

import { useState } from 'react'

export default function ProductPage() {
  const [loading, setLoading] = useState(false)  // Cuando es setLoaging(true) => muesta "Rudirigiendo" / Cuando termina la petición  setLoading(false) =>  vuelve "Comprar Ahora"

  const handleBuy = async () => {   // la funcion se ejecuta cunado el usuario pulsa el boton 


    setLoading(true)
    try {
      // Hace una petición HTTP   a la url  api/pagos
      const res = await fetch('/api/pagos', {
        method: 'POST', // tipo de petición: enviamos datos, no pedimos.


        headers: { 'Content-Type': 'application/json' }, // le Le decimos al servidor que enviamos JSON
      })

      const data = await res.json() //Convierte la respuesta del servidor (que viene en formato JSON) a un objeto JavaScript
      
      if (data.url) {
        window.location.href = data.url // Si el servidor devolvió una URL, redirige al usuario a esa página (Stripe Checkout). Si no, muestra un mensaje de error.
      } else {
        alert('Error al crear la sesión de pago')
      }
    } catch (error) {
      alert('Error de conexión')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-5">
      <div className="bg-white rounded-2xl p-10 max-w-md w-full shadow-lg text-center">
        <div className="w-20 h-20 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl mx-auto mb-6 flex items-center justify-center text-4xl">
          📦
        </div>

        <h1 className="text-3xl text-emerald-800 font-bold mb-3">
          Ebook Pro
        </h1>
        
        <p className="text-gray-500 mb-6 leading-relaxed">
          La guía definitiva para dominar el desarrollo web moderno. 
          Incluye 200+ páginas de contenido práctico.
        </p>

        <div className="text-4xl font-extrabold text-indigo-600 mb-6">
          €29.99
        </div>

        <button
          onClick={handleBuy}
          disabled={loading}
          className="w-full py-4 px-6 text-lg font-semibold text-white bg-gradient-to-r from-indigo-500 to-purple-600 rounded-xl shadow-lg shadow-indigo-500/30 hover:-translate-y-0.5 transition-all disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0"
        >
          {loading ? 'Redirigiendo a Stripe...' : 'Comprar Ahora'}
        </button>

        <p className="mt-4 text-xs text-gray-400">
          Pago seguro procesado por Stripe 🔒
        </p>
      </div>
    </main>
  )
}
