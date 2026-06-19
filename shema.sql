-- Tabla de pedidos
CREATE TABLE pedidos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_email TEXT,
  total INTEGER, -- en céntimos
  estado TEXT DEFAULT 'pendiente', -- pendiente, pagado, cancelado
  estado_pago TEXT DEFAULT 'pendiente', -- pendiente, pagado, cancelado
  stripe_session TEXT,
  stripe_payment TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Tabla de items del pedido (por si hay varios productos)
CREATE TABLE pedido_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id UUID REFERENCES pedidos(id),
  producto_nombre TEXT,
  cantidad INTEGER,
  precio_unit INTEGER -- en céntimos
);

-- Política RLS básica (opcional para el examen, pero buena práctica)
ALTER TABLE pedidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedido_items ENABLE ROW LEVEL SECURITY;