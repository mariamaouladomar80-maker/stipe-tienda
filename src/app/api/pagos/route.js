import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabase } from '@/lib/supabase'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
})

export async function POST(request) {
  try {
    // 1. Crear el pedido en Supabase PRIMERO (estado_pago: 'pendiente')
    const { data: pedido, error: dbError } = await supabase
      .from('pedidos')
      .insert({
        total: 2999, // €29.99 en céntimos
        estado: 'pendiente',
        estado_pago: 'pendiente',
      })
      .select()
      .single()

    if (dbError) throw dbError

    // 2. Crear la sesión de checkout en Stripe
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
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
      success_url: `${request.headers.get('origin')}/success?pedido_id=${pedido.id}`,
      cancel_url: `${request.headers.get('origin')}/cancel?pedido_id=${pedido.id}`,
      // Guardamos el ID de nuestro pedido para recuperarlo en el webhook
      metadata: {
        pedido_id: pedido.id,
      },
    })

    // 3. Guardar el stripe_session en el pedido
    await supabase
      .from('pedidos')
      .update({ stripe_session: session.id })
      .eq('id', pedido.id)

    return NextResponse.json({ url: session.url })
  } catch (error) {
    console.error('Error creando sesión:', error)
    return NextResponse.json(
      { error: 'Error al crear la sesión de pago' },
      { status: 500 }
    )
  }
}