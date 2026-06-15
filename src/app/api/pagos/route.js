import { NextResponse } from 'next/server'  // Para devolver respuestas HTTP con formato JSON de forma sencilla. Es como res.json() de Express pero adaptado a Next.js App Router.
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
})

export async function POST(request) {

    // Crear seccion 
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [ // define el producto que se va a vender 
        {
          price_data: {
            currency: 'eur',
            product_data: {
              name: 'Ebook Pro',
              description: 'La guía definitiva para dominar el desarrollo web moderno',
            },
                unit_amount: 2999,
            
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      
      success_url: `${request.headers.get('origin')}/success`, // Cuando el pago se completa correctamente 
      cancel_url: `${request.headers.get('origin')}/cancel`, // Cuando el usuario abandona el pago.

      // ${request.headers.get('origin')} detecta automáticamente la URL de tu web (local o producción), así no tienes que cambiar el código al subirla.

      
    })

    return NextResponse.json({ url: session.url })
  } 
  // Manejar el error 
  catch (error) {
    console.error('Error creando sesión:', error)
    return NextResponse.json(
      { error: 'Error al crear la sesión de pago' },
      { status: 500 }
    )
  }
}