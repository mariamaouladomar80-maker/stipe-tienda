import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabase } from '@/lib/supabase'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
})

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

export async function POST(request) {
  const payload = await request.text()
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
      const pedidoId = session.metadata?.pedido_id

      if (!pedidoId) {
        console.error('No se encontró pedido_id en metadata')
        break
      }

      // Actualizar el pedido en Supabase
      const { error } = await supabase
        .from('pedidos')
        .update({
          estado_pago: 'pagado',
          stripe_payment: session.payment_intent,
          cliente_email: session.customer_details?.email || session.customer_email,
        })
        .eq('id', pedidoId)
        .eq('estado_pago', 'pendiente') // Protección contra duplicados

      if (error) {
        console.error('Error actualizando pedido:', error)
      } else {
        console.log(`✅ Pedido ${pedidoId} marcado como pagado`)
      }

      break
    }

    case 'checkout.session.expired': {
      const session = event.data.object
      const pedidoId = session.metadata?.pedido_id

      if (pedidoId) {
        await supabase
          .from('pedidos')
          .update({ estado_pago: 'cancelado' })
          .eq('id', pedidoId)
          .eq('estado_pago', 'pendiente')

        console.log(`⏰ Pedido ${pedidoId} marcado como cancelado (sesión expirada)`)
      }

      break
    }

    default:
      console.log(`Evento no manejado: ${event.type}`)
  }

  return NextResponse.json({ received: true })
}