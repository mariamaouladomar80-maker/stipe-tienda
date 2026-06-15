import { NextResponse } from 'next/server'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
})

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

export async function POST(request) {
  const payload = await request.text() // Lee el cuerpo de la petición como texto plano (string).¿Por qué .text() y no .json()? Porque Stripe envía el payload como texto plano, y necesitamos ese texto exacto para verificar la firma. Si lo convirtiéramos a JSON primero, perderíamos el formato original y la firma no coincidiría.
  
  const signature = request.headers.get('stripe-signature')

  let event

  try {
    event = stripe.webhooks.constructEvent(payload, signature, webhookSecret)
  } catch (err) {
    console.error(`⚠️ Webhook signature verification failed: ${err.message}`)
    return NextResponse.json(
      { error: 'Invalid signature' },
      { status: 400 }
    )
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object
      
      const customerEmail = session.customer_details?.email || session.customer_email || 'No disponible'
      const amountTotal = session.amount_total ? (session.amount_total / 100).toFixed(2) : '0.00'
      const currency = session.currency?.toUpperCase() || 'EUR'

      console.log('✅ PAGO COMPLETADO')
      console.log(`📧 Email: ${customerEmail}`)
      console.log(`💰 Importe: ${amountTotal} ${currency}`)
      console.log(`🆔 Session ID: ${session.id}`)
      console.log('----------------------------------------')

      break
    }
    
    default:
      console.log(`Evento no manejado: ${event.type}`)
  }

  return NextResponse.json({ received: true })
}