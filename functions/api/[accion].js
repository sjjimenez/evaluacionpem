/**
 * Cloudflare Pages Function: POST /api/login y /api/upload.
 * URL real de Apps Script y token solo en secretos del proyecto Cloudflare.
 */
export async function onRequestPost({ request, env, params }) {
  const noStore = { 'Cache-Control':'no-store, private', 'X-Content-Type-Options':'nosniff' };
  const respond = (obj,status=200) => Response.json(obj,{status,headers:noStore});
  const action = params.accion;
  if (action !== 'login' && action !== 'upload') return respond({ok:false,error:'Operación no permitida.'},404);
  if (!env.APPS_SCRIPT_URL || !env.PROXY_TOKEN) return respond({ok:false,error:'El portal aún no está configurado.'},503);
  // No seguir redirecciones que procedan del navegador: únicamente las del servidor hacia Google.
  const maxBody = action === 'upload' ? 7_300_000 : 2048;
  const len = Number(request.headers.get('content-length') || 0);
  if (len > maxBody) return respond({ok:false,error:'Solicitud demasiado grande.'},413);
  if (!String(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) {
    return respond({ok:false,error:'Se requiere JSON.'},415);
  }
  let payload;
  try {
    const raw=await request.text();
    if(raw.length > maxBody) return respond({ok:false,error:'Solicitud demasiado grande.'},413);
    payload=JSON.parse(raw);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('JSON inválido.');
  } catch(_) { return respond({ok:false,error:'Datos inválidos.'},400); }
  if (!/^\d{5,12}$/.test(String(payload.cedula || '')) || !/^[A-Fa-f0-9]{16}$/.test(String(payload.clave || ''))) {
    return respond({ok:false,error:'Cédula o clave inválida.'},400);
  }
  const url = String(env.APPS_SCRIPT_URL).trim();
  let gas;
  try {
    gas = new URL(url);
    if (gas.protocol!=='https:' || gas.hostname!=='script.google.com' ||
        !/^\/macros\/s\/[^/]+\/exec$/.test(gas.pathname) || gas.search) {
      throw new Error('Invalid Apps Script URL');
    }
  } catch(_) { return respond({ok:false,error:'La configuración del servidor es inválida.'},503); }
  const upstreamBody = JSON.stringify({
    token: env.PROXY_TOKEN,
    action,
    cedula:payload.cedula,
    clave:payload.clave,
    ...(action==='upload' ? { nombreArchivo:payload.nombreArchivo, archivoBase64:payload.archivoBase64 } : {})
  });
  try {
    const response=await fetch(gas.toString(),{
      method:'POST',
      headers:{'Content-Type':'text/plain;charset=UTF-8'},
      body:upstreamBody,
      redirect:'follow'
    });
    if (!response.ok) return respond({ok:false,error:'Servicio de Google temporalmente no disponible.'},502);
    const text=await response.text();
    if(text.length > 12_000_000) return respond({ok:false,error:'Respuesta del servidor demasiado grande.'},502);
    let result;
    try { result=JSON.parse(text); } catch(_){
      return respond({ok:false,error:'Apps Script devolvió un formato inesperado. Verifique el despliegue y sus permisos.'},502);
    }
    if (!result || typeof result.ok!=='boolean') return respond({ok:false,error:'Respuesta no válida del servicio.'},502);
    return respond(result,result.ok ? 200 : 400);
  } catch(_err) {
    // No exponer URL /exec, token ni detalles internos en la respuesta.
    return respond({ok:false,error:'No fue posible contactar el servicio. Intente nuevamente.'},502);
  }
}

export function onRequestGet() {
  return Response.json({ok:false,error:'Método no permitido.'},{status:405,headers:{'Cache-Control':'no-store'}});
}
