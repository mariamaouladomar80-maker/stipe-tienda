# 🎓 Guía de Examen — Stripe + Supabase (Proyecto de Pagos)

> **Plantilla reutilizable** para cualquier proyecto de paso con Stripe y base de datos.
> Basado en: Next.js App Router + Supabase + Stripe Checkout + Webhooks.

---

## 📁 Estructura del Proyecto

```
src/
├── app/
│   ├── api/
│   │   ├── pagos/
│   │   │   └── route.js          ← Crea pedido en Supabase + Stripe checkout
│   │   └── webhook/
│   │       └── route.js          ← Webhook: actualiza pedido en Supabase
│   ├── cancel/
│   │   └── page.jsx              ← Pago cancelado
│   ├── success/
│   │   └── page.jsx              ← Pago exitoso (lee de Supabase)
│   └── page.jsx                  ← Página del producto (botón comprar)
├── lib/
│   └── supabase.js               ← Cliente Supabase con service_role
└── schema.sql                    ← Tablas de la base de datos
```

---

## 🗄️ Paso 1: Esquema SQL (Supabase)

Ejecutar en SQL Editor de Supabase. **Válido para cualquier proyecto de pagos.**

```sql
-- Tabla de pedidos
CREATE TABLE pedidos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_email TEXT,
  total INTEGER,                    -- en céntimos (Stripe trabaja en céntimos)
  estado TEXT DEFAULT 'pendiente',   -- flujo interno: pendiente → preparando → listo → entregado
  estado_pago TEXT DEFAULT 'pendiente', -- flujo de pago: pendiente → pagado → cancelado
  stripe_session TEXT,               -- ID de sesión de Stripe (cs_test_...)
  stripe_payment TEXT,               -- ID del pago confirmado (pi_...)
  created_at TIMESTAMP DEFAULT NOW()
);

-- Tabla de items del pedido (si hay varios productos)
CREATE TABLE pedido_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id UUID REFERENCES pedidos(id) ON DELETE CASCADE,
  producto_nombre TEXT,
  cantidad INTEGER DEFAULT 1,
  precio_unit INTEGER               -- en céntimos
);

-- RLS opcional (buena práctica)
ALTER TABLE pedidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedido_items ENABLE ROW LEVEL SECURITY;
```

> **Regla de oro:** Stripe siempre trabaja en **céntimos**. 29.99€ = `2999`.

---

## 🔑 Paso 2: Variables de Entorno (.env.local)

```env
# Stripe
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

> `SUPABASE_SERVICE_ROLE_KEY` → Dashboard → Project Settings → API → `service_role` (la que tiene `service_role`, NO la `anon`).

---

## 🔌 Paso 3: Cliente Supabase (src/lib/supabase.js)

```js
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

export const supabase = createClient(supabaseUrl, supabaseServiceKey)
```

> Se usa `service_role` para saltarse RLS desde el servidor. **Nunca expongas esta key al cliente.**

---

## 💳 Paso 4: API Route — Crear Checkout (/api/pagos/route.js)

**Flujo:**
1. Crear pedido en Supabase (`estado_pago: 'pendiente'`)
2. Crear sesión de Stripe con `metadata: { pedido_id }`
3. Guardar `stripe_session` en el pedido
4. Devolver `url` al cliente

```js
import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabase } from '@/lib/supabase'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
})

export async function POST(request) {
  try {
    // 1. Crear pedido en Supabase PRIMERO
    const { data: pedido, error: dbError } = await supabase
      .from('pedidos')
      .insert({
        total: 2999,                    // €29.99 en céntimos
        estado: 'pendiente',
        estado_pago: 'pendiente',
      })
      .select()
      .single()

    if (dbError) throw dbError

    // 2. Crear sesión de checkout en Stripe
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'eur',
            product_data: {
              name: 'Ebook Pro',
              description: 'La guía definitiva...',
            },
            unit_amount: 2999,          // céntimos
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${request.headers.get('origin')}/success?pedido_id=${pedido.id}`,
      cancel_url: `${request.headers.get('origin')}/cancel?pedido_id=${pedido.id}`,
      metadata: {
        pedido_id: pedido.id,         // ← CLAVE: para recuperar en el webhook
      },
    })

    // 3. Guardar stripe_session en el pedido
    await supabase
      .from('pedidos')
      .update({ stripe_session: session.id })
      .eq('id', pedido.id)

    return NextResponse.json({ url: session.url })

  } catch (error) {
    console.error('Error:', error)
    return NextResponse.json(
      { error: 'Error al crear la sesión de pago' },
      { status: 500 }
    )
  }
}
```

### 🔑 Puntos clave del checkout:

| Campo | Para qué sirve |
|-------|---------------|
| `metadata: { pedido_id }` | Permite al webhook saber qué pedido actualizar |
| `success_url?pedido_id=` | La página de éxito recibe el ID para mostrar datos |
| `cancel_url?pedido_id=` | La página de cancelación puede marcar como cancelado |
| `unit_amount` | Siempre en **céntimos** |

---

## 🔔 Paso 5: Webhook — Confirmar Pago (/api/webhook/route.js)

**Flujo:**
1. Verificar firma del webhook (`stripe.webhooks.constructEvent`)
2. Leer `pedido_id` de `metadata`
3. Actualizar `estado_pago = 'pagado'` en Supabase
4. Protección contra duplicados: `.eq('estado_pago', 'pendiente')`

```js
import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabase } from '@/lib/supabase'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
})

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

export async function POST(request) {
  const payload = await request.text()           // ← SIEMPRE .text(), nunca .json()
  const signature = request.headers.get('stripe-signature')

  let event

  try {
    event = stripe.webhooks.constructEvent(payload, signature, webhookSecret)
  } catch (err) {
    console.error(`⚠️ Firma inválida: ${err.message}`)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object
      const pedidoId = session.metadata?.pedido_id

      if (!pedidoId) break

      // Actualizar pedido como pagado
      const { error } = await supabase
        .from('pedidos')
        .update({
          estado_pago: 'pagado',
          stripe_payment: session.payment_intent,
          cliente_email: session.customer_details?.email || session.customer_email,
        })
        .eq('id', pedidoId)
        .eq('estado_pago', 'pendiente')   // ← PROTECCIÓN: solo si aún está pendiente

      if (error) console.error('Error actualizando pedido:', error)
      else console.log(`✅ Pedido ${pedidoId} pagado`)

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

        console.log(`⏰ Pedido ${pedidoId} cancelado (expirado)`)
      }
      break
    }

    default:
      console.log(`Evento no manejado: ${event.type}`)
  }

  return NextResponse.json({ received: true })    // ← SIEMPRE 200, aunque no se maneje
}
```

### 🛡️ Protecciones del webhook:

| Protección | Cómo se implementa | Por qué |
|-----------|-------------------|---------|
| Verificar origen | `stripe.webhooks.constructEvent` + `STRIPE_WEBHOOK_SECRET` | Evita webhooks falsos |
| Duplicados | `.eq('estado_pago', 'pendiente')` | No marca pagado 2 veces |
| Metadata vacía | `if (!pedidoId) break` | No rompe si falta el ID |
| Siempre 200 | `return NextResponse.json({ received: true })` | Stripe no reintenta innecesariamente |

---

## ✅ Paso 6: Página de Éxito (/success/page.jsx)

### Opción A: Server Component (recomendada, más simple)

```jsx
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

export default async function SuccessPage({ searchParams }) {
  const pedidoId = searchParams?.pedido_id

  let pedido = null
  if (pedidoId) {
    const { data } = await supabase
      .from('pedidos')
      .select('*')
      .eq('id', pedidoId)
      .single()
    pedido = data
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-5">
      <div className="bg-white rounded-2xl p-10 max-w-md w-full shadow-lg text-center">
        <div className="w-20 h-20 bg-green-500 rounded-full mx-auto mb-6 flex items-center justify-center text-4xl text-white">
          ✓
        </div>

        <h1 className="text-3xl font-bold mb-3 text-green-500">
          ¡Pago Completado!
        </h1>

        <p className="text-gray-500 mb-4">
          Gracias por tu compra.
        </p>

        {pedido && (
          <div className="bg-gray-50 rounded-lg p-4 mb-6 text-left text-sm">
            <p><strong>Pedido:</strong> {pedido.id?.slice(0, 8)}...</p>
            <p><strong>Total:</strong> €{(pedido.total / 100).toFixed(2)}</p>
            <p><strong>Estado:</strong> {pedido.estado_pago}</p>
          </div>
        )}

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
```

### Opción B: Client Component (si el profe lo pide explícitamente)

```jsx
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

export default function SuccessPage() {
  const searchParams = useSearchParams()
  const pedidoId = searchParams.get('pedido_id')
  const [pedido, setPedido] = useState(null)

  useEffect(() => {
    if (!pedidoId) return

    async function cargarPedido() {
      const res = await fetch(`/api/pedidos/${pedidoId}`)
      const data = await res.json()
      setPedido(data)
    }

    cargarPedido()
  }, [pedidoId])

  return (
    <main className="min-h-screen flex items-center justify-center p-5">
      <div className="bg-white rounded-2xl p-10 max-w-md w-full shadow-lg text-center">
        <div className="w-20 h-20 bg-green-500 rounded-full mx-auto mb-6 flex items-center justify-center text-4xl text-white">
          ✓
        </div>

        <h1 className="text-3xl font-bold mb-3 text-green-500">
          ¡Pago Completado!
        </h1>

        <p className="text-gray-500 mb-4">
          Gracias por tu compra.
        </p>

        {pedido && (
          <div className="bg-gray-50 rounded-lg p-4 mb-6 text-left text-sm">
            <p><strong>Pedido:</strong> {pedido.id?.slice(0, 8)}...</p>
            <p><strong>Total:</strong> €{(pedido.total / 100).toFixed(2)}</p>
            <p><strong>Estado:</strong> {pedido.estado_pago}</p>
          </div>
        )}

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
```

> **Si usas Opción B**, necesitas crear la API Route `/api/pedidos/[id]/route.js`:

```js
import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(request, { params }) {
  const { id } = params

  const { data, error } = await supabase
    .from('pedidos')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}
```

---

## ❌ Paso 7: Página de Cancelación (/cancel/page.jsx)

```jsx
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

export default async function CancelPage({ searchParams }) {
  const pedidoId = searchParams?.pedido_id

  // Opcional: marcar como cancelado en la base de datos
  if (pedidoId) {
    await supabase
      .from('pedidos')
      .update({ estado_pago: 'cancelado' })
      .eq('id', pedidoId)
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-5">
      <div className="bg-white rounded-2xl p-10 max-w-md w-full shadow-lg text-center">
        <div className="w-20 h-20 bg-red-500 rounded-full mx-auto mb-6 flex items-center justify-center text-4xl text-white">
          ✕
        </div>

        <h1 className="text-3xl font-bold mb-3 text-red-500">
          Pago Cancelado
        </h1>

        <p className="text-gray-500 mb-6">
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
```

---

## 🛒 Paso 8: Página del Producto (page.jsx)

```jsx
'use client'

import { useState } from 'react'

export default function ProductPage() {
  const [loading, setLoading] = useState(false)

  const handleBuy = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/pagos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      const data = await res.json()

      if (data.url) {
        window.location.href = data.url
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
        <h1 className="text-3xl font-bold mb-3">Ebook Pro</h1>
        <p className="text-gray-500 mb-6">La guía definitiva...</p>
        <div className="text-4xl font-extrabold text-indigo-600 mb-6">€29.99</div>

        <button
          onClick={handleBuy}
          disabled={loading}
          className="w-full py-4 px-6 text-lg font-semibold text-white bg-indigo-500 rounded-xl hover:bg-indigo-600 transition-colors disabled:opacity-60"
        >
          {loading ? 'Redirigiendo...' : 'Comprar Ahora'}
        </button>
      </div>
    </main>
  )
}
```

---

## 🧪 Testing en Local con Stripe CLI

```bash
# Terminal 1: Escuchar webhooks y reenviar a local
stripe listen --forward-to localhost:3000/api/webhook

# Copiar el webhook secret que muestra (whsec_...) a .env.local como STRIPE_WEBHOOK_SECRET

# Terminal 2: Simular un pago completado
stripe trigger checkout.session.completed

# Terminal 3: Simular sesión expirada
stripe trigger checkout.session.expired
```

### Tarjeta de prueba:
- **Número:** `4242 4242 4242 4242`
- **Fecha:** `12/34`
- **CVC:** `123`

---

## 🧠 Checklist Mental para el Examen

### Antes de empezar a codear:
- [ ] ¿Tengo las 4 variables de entorno en `.env.local`?
- [ ] ¿He creado las tablas en Supabase SQL Editor?
- [ ] ¿He instalado `stripe` y `@supabase/supabase-js`?

### En `/api/pagos`:
- [ ] ¿Creo el pedido en Supabase **antes** de llamar a Stripe?
- [ ] ¿Uso `metadata: { pedido_id }` para recuperar en el webhook?
- [ ] ¿Los precios están en **céntimos**?
- [ ] ¿Devuelvo `{ url: session.url }` al cliente?

### En `/api/webhook`:
- [ ] ¿Uso `await request.text()` (NO `.json()`) para el body?
- [ ] ¿Verifico la firma con `stripe.webhooks.constructEvent`?
- [ ] ¿Leo `pedido_id` de `session.metadata`?
- [ ] ¿Actualizo con `.eq('estado_pago', 'pendiente')` para proteger duplicados?
- [ ] ¿Siempre respondo 200 con `{ received: true }`?

### En la página de éxito:
- [ ] ¿Recibo `pedido_id` por `searchParams`?
- [ ] ¿Leo el pedido de Supabase para mostrar datos reales?

---

## 🚨 Errores Comunes y Soluciones

| Error | Causa | Solución |
|-------|-------|----------|
| `Invalid signature` en webhook | `STRIPE_WEBHOOK_SECRET` no coincide con el de `stripe listen` | Copiar el `whsec_...` que muestra `stripe listen` cada vez que se inicia |
| `undefined` al leer variable en Client Component | Falta `NEXT_PUBLIC_` en la variable | Añadir `NEXT_PUBLIC_` al nombre |
| Precio incorrecto en Stripe | Pasar euros en lugar de céntimos | Multiplicar por 100: `Math.round(precio * 100)` |
| Pedido no se marca como pagado | Falta `metadata.pedido_id` en la sesión | Asegurar que `metadata: { pedido_id }` está en `stripe.checkout.sessions.create` |
| Webhook marca pagado 2 veces | Falta `.eq('estado_pago', 'pendiente')` | Añadir la condición de protección |

---

## 📚 Diferencias Clave: Estado vs Estado de Pago

| Campo | Controla | Valores posibles |
|-------|---------|-----------------|
| `estado` | Flujo interno de negocio (cocina, preparación, envío) | `pendiente → en_barra → listo → entregado` |
| `estado_pago` | Si el dinero se cobró o no | `pendiente → pagado → cancelado` |

> Son **independientes**. Un pedido puede estar `listo` (en cocina) y `pagado` al mismo tiempo.

---

## 🔄 Flujo Completo Visual

```
Usuario pulsa "Comprar"
        ↓
[Client] fetch('/api/pagos')
        ↓
[Server] /api/pagos
  1. Crea pedido en Supabase (estado_pago: 'pendiente')
  2. Crea sesión Stripe con metadata.pedido_id
  3. Guarda stripe_session en pedido
  4. Devuelve { url }
        ↓
[Client] window.location.href = url de Stripe
        ↓
Usuario paga en Stripe
        ↓
Stripe envía webhook POST /api/webhook
        ↓
[Server] /api/webhook
  1. Verifica firma
  2. Lee pedido_id de metadata
  3. Actualiza estado_pago = 'pagado'
  4. Responde 200
        ↓
Stripe redirige a /success?pedido_id=xxx
        ↓
[Server/Client] Lee pedido de Supabase y muestra confirmación
```

---

> **¡Suerte en el examen!** 🍀
> Revisa especialmente: céntimos vs euros, metadata, protección duplicados, y siempre 200 en webhook.
