#!/usr/bin/env python3
# Genera el PDF de viabilidad: chat en vivo vs grabacion de videollamada.
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.platypus import (
    BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, KeepTogether
)

OUT = "/Users/moramjose/Documents/Projects/FaimLab/ensenameya/docs/INTEGRACION-CHAT-Y-GRABACION.pdf"

# --- Paleta ---
INK     = colors.HexColor("#1d2430")
MUTED   = colors.HexColor("#5b6471")
BRAND   = colors.HexColor("#2563eb")   # azul
GREEN   = colors.HexColor("#0f9d58")   # baja complejidad
AMBER   = colors.HexColor("#d98c00")   # media/alta
LINE    = colors.HexColor("#d8dde6")
LIGHTBG = colors.HexColor("#f3f6fb")
HEADBG  = colors.HexColor("#1d2430")

styles = getSampleStyleSheet()

def S(name, **kw):
    return ParagraphStyle(name, parent=styles["Normal"], **kw)

st_title   = S("t",  fontName="Helvetica-Bold", fontSize=21, textColor=colors.white, leading=25)
st_sub     = S("s",  fontName="Helvetica",      fontSize=10.5, textColor=colors.HexColor("#c7d2e6"), leading=14)
st_h1      = S("h1", fontName="Helvetica-Bold", fontSize=14.5, textColor=INK, leading=18, spaceBefore=16, spaceAfter=6)
st_h2      = S("h2", fontName="Helvetica-Bold", fontSize=11.5, textColor=BRAND, leading=15, spaceBefore=10, spaceAfter=3)
st_body    = S("b",  fontName="Helvetica",      fontSize=10, textColor=INK, leading=15, alignment=TA_JUSTIFY, spaceAfter=6)
st_bodyl   = S("bl", fontName="Helvetica",      fontSize=10, textColor=INK, leading=15, alignment=TA_LEFT, spaceAfter=6)
st_quote   = S("q",  fontName="Helvetica-Oblique", fontSize=10.5, textColor=INK, leading=16, leftIndent=10, rightIndent=10)
st_small   = S("sm", fontName="Helvetica",      fontSize=8.5, textColor=MUTED, leading=12)
st_cellh   = S("ch", fontName="Helvetica-Bold", fontSize=9, textColor=colors.white, leading=12)
st_cell    = S("c",  fontName="Helvetica",      fontSize=9, textColor=INK, leading=12.5)
st_cellb   = S("cb", fontName="Helvetica-Bold", fontSize=9, textColor=INK, leading=12.5)
st_callout = S("co", fontName="Helvetica",      fontSize=9.5, textColor=INK, leading=14)

def chip(text, color):
    t = Table([[Paragraph(f'<font color="white"><b>{text}</b></font>',
                          S("x", fontSize=8.5, alignment=TA_CENTER))]],
              colWidths=[44*mm], hAlign="LEFT")
    t.setStyle(TableStyle([
        ("BACKGROUND",(0,0),(-1,-1), color),
        ("LEFTPADDING",(0,0),(-1,-1),6),("RIGHTPADDING",(0,0),(-1,-1),6),
        ("TOPPADDING",(0,0),(-1,-1),2),("BOTTOMPADDING",(0,0),(-1,-1),2),
        ("ROUNDEDCORNERS",[3,3,3,3]),
    ]))
    return t

# --- Plantilla con cabecera/pie ---
PW, PH = A4
def header_footer(canvas, doc):
    canvas.saveState()
    # pie
    canvas.setStrokeColor(LINE); canvas.setLineWidth(0.5)
    canvas.line(18*mm, 14*mm, PW-18*mm, 14*mm)
    canvas.setFont("Helvetica", 8); canvas.setFillColor(MUTED)
    canvas.drawString(18*mm, 9.5*mm, "Ensename Ya - Documento tecnico interno")
    canvas.drawRightString(PW-18*mm, 9.5*mm, f"Pagina {doc.page}")
    canvas.drawCentredString(PW/2, 9.5*mm, "FaimLab")
    canvas.restoreState()

doc = BaseDocTemplate(
    OUT, pagesize=A4,
    leftMargin=18*mm, rightMargin=18*mm, topMargin=18*mm, bottomMargin=20*mm,
    title="Integracion de chat y grabacion - Ensename Ya",
    author="FaimLab",
)
frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="main")
doc.addPageTemplates([PageTemplate(id="all", frames=[frame], onPage=header_footer)])

def hr(c=LINE, w=0.6, sb=2, sa=8):
    return HRFlowable(width="100%", thickness=w, color=c, spaceBefore=sb, spaceAfter=sa)

story = []

# ---------- Banner de titulo ----------
banner = Table([[Paragraph("Chat en vivo y grabacion de la videollamada", st_title)],
                [Paragraph("Analisis de viabilidad, complejidad y estimacion de tiempos &nbsp;|&nbsp; "
                           "18 de junio de 2026 &nbsp;|&nbsp; v1", st_sub)]],
               colWidths=[doc.width])
banner.setStyle(TableStyle([
    ("BACKGROUND",(0,0),(-1,-1), HEADBG),
    ("LEFTPADDING",(0,0),(-1,-1),16),("RIGHTPADDING",(0,0),(-1,-1),16),
    ("TOPPADDING",(0,0),(0,0),16),("BOTTOMPADDING",(0,0),(0,0),2),
    ("TOPPADDING",(0,1),(0,1),0),("BOTTOMPADDING",(0,1),(0,1),16),
]))
story += [banner, Spacer(1, 12)]

# ---------- Resumen ejecutivo ----------
story += [Paragraph("Resumen ejecutivo", st_h1), hr()]
story += [Paragraph(
    "El pedido del cliente combina <b>dos integraciones distintas</b> que conviene separar, porque "
    "su complejidad, su coste y su tiempo de entrega no tienen nada que ver entre si:", st_body)]

resumen = Table([
    [Paragraph("<b>Integracion</b>", st_cellh),
     Paragraph("<b>Que es</b>", st_cellh),
     Paragraph("<b>Complejidad</b>", st_cellh),
     Paragraph("<b>Coste extra</b>", st_cellh),
     Paragraph("<b>Estimado</b>", st_cellh)],
    [Paragraph("A. Chat en vivo<br/>(persistente y descargable)", st_cellb),
     Paragraph("Mensajeria 1:1 alumno-tutor ligada a la sesion", st_cell),
     Paragraph("<font color='#0f9d58'><b>Baja</b></font>", st_cell),
     Paragraph("Ninguno<br/>(ya en el stack)", st_cell),
     Paragraph("<b>~1 semana</b>", st_cell)],
    [Paragraph("B. Grabacion de<br/>la videollamada", st_cellb),
     Paragraph("Guardar el video de la clase y descargarlo", st_cell),
     Paragraph("<font color='#d98c00'><b>Media</b></font>", st_cell),
     Paragraph("Si: add-on de<br/>pago + almacen.", st_cell),
     Paragraph("<b>~1 - 1.5 sem<br/>+ decision</b>", st_cell)],
], colWidths=[34*mm, 44*mm, 24*mm, 30*mm, 30*mm])
resumen.setStyle(TableStyle([
    ("BACKGROUND",(0,0),(-1,0), HEADBG),
    ("ROWBACKGROUNDS",(0,1),(-1,-1), [colors.white, LIGHTBG]),
    ("GRID",(0,0),(-1,-1),0.5, LINE),
    ("VALIGN",(0,0),(-1,-1),"MIDDLE"),
    ("LEFTPADDING",(0,0),(-1,-1),6),("RIGHTPADDING",(0,0),(-1,-1),6),
    ("TOPPADDING",(0,0),(-1,-1),5),("BOTTOMPADDING",(0,0),(-1,-1),5),
]))
story += [resumen, Spacer(1,8)]

story += [Paragraph(
    "<b>Conclusion:</b> el chat es facil y barato, sale en una semana. Lo que el cliente describe como "
    "\"que se guarda la llamada\" es en realidad <b>grabar el video</b>, una funcion aparte, de pago, que "
    "hoy no esta planificada y requiere una decision suya antes de cotizarla en firme.", st_body)]

# ---------- El pedido ----------
story += [Paragraph("El pedido, tal cual", st_h1), hr()]
q = Table([[Paragraph(
    '"Genera una opcion donde sea el chat en vivo en la llamada y que ese chat se pueda activar '
    '2 dias antes de la sesion y se guarde por los proximos 30 dias en los que se guarda la '
    'llamada y que se pueda descargar."', st_quote)]], colWidths=[doc.width])
q.setStyle(TableStyle([
    ("BACKGROUND",(0,0),(-1,-1), LIGHTBG),
    ("LINEBEFORE",(0,0),(0,-1), 3, BRAND),
    ("LEFTPADDING",(0,0),(-1,-1),12),("RIGHTPADDING",(0,0),(-1,-1),12),
    ("TOPPADDING",(0,0),(-1,-1),10),("BOTTOMPADDING",(0,0),(-1,-1),10),
]))
story += [q, Spacer(1,6)]
story += [Paragraph(
    "Dentro de esta frase hay cuatro requisitos para el chat (en vivo, activar 2 dias antes, "
    "guardar 30 dias, descargar) y, escondido, un quinto que es otra cosa: <b>guardar la llamada</b> "
    "(el video). Los tratamos por separado.", st_body)]

# ---------- Integracion A ----------
story += [Paragraph("Integracion A &mdash; Chat en vivo persistente", st_h1), hr()]
story += [chip("COMPLEJIDAD BAJA", GREEN), Spacer(1,6)]

story += [Paragraph("El detalle importante", st_h2)]
story += [Paragraph(
    "El chat que trae Daily (nuestro proveedor de video) integrado <b>no sirve</b> para esto: es "
    "<b>efimero</b>: los mensajes desaparecen al cerrar la llamada, solo existen durante la sesion y "
    "no se pueden descargar. Incumple 3 de los 4 requisitos. Es un callejon sin salida.", st_body)]
story += [Paragraph(
    "La solucion correcta es, ademas, la mas sencilla: una tabla <b>messages</b> en nuestra propia base "
    "de datos (Supabase) y su canal de tiempo real (<b>Supabase Realtime</b>), que <b>ya forma parte de "
    "nuestro stack</b>. Cero dependencias nuevas, cero costes nuevos. Es menos trabajo que intentar "
    "rescatar el chat de Daily, y cubre los cuatro requisitos.", st_body)]

story += [Paragraph("Como se cubre cada requisito", st_h2)]
tA = Table([
    [Paragraph("<b>Requisito del cliente</b>", st_cellh),
     Paragraph("<b>Como se resuelve</b>", st_cellh),
     Paragraph("<b>Dificultad</b>", st_cellh)],
    [Paragraph("Chat en vivo dentro de la llamada", st_cell),
     Paragraph("Panel de chat al lado del video (controlamos la pagina que lo embebe) + tiempo real", st_cell),
     Paragraph("<font color='#0f9d58'>Baja</font>", st_cell)],
    [Paragraph("Activarlo 2 dias antes de la sesion", st_cell),
     Paragraph("Una regla que compara la fecha de la sesion con la fecha actual (UTC)", st_cell),
     Paragraph("<font color='#0f9d58'>Trivial</font>", st_cell)],
    [Paragraph("Guardarlo 30 dias", st_cell),
     Paragraph("Son filas en la base de datos; limpieza automatica programada (pg_cron, nativo)", st_cell),
     Paragraph("<font color='#0f9d58'>Baja</font>", st_cell)],
    [Paragraph("Descargarlo", st_cell),
     Paragraph("Boton que arma un archivo .txt / .json con la conversacion", st_cell),
     Paragraph("<font color='#0f9d58'>Trivial</font>", st_cell)],
], colWidths=[52*mm, 86*mm, 24*mm])
tA.setStyle(TableStyle([
    ("BACKGROUND",(0,0),(-1,0), BRAND),
    ("ROWBACKGROUNDS",(0,1),(-1,-1), [colors.white, LIGHTBG]),
    ("GRID",(0,0),(-1,-1),0.5, LINE),
    ("VALIGN",(0,0),(-1,-1),"MIDDLE"),
    ("LEFTPADDING",(0,0),(-1,-1),6),("RIGHTPADDING",(0,0),(-1,-1),6),
    ("TOPPADDING",(0,0),(-1,-1),5),("BOTTOMPADDING",(0,0),(-1,-1),5),
]))
story += [tA, Spacer(1,8)]
story += [Paragraph(
    "Encaja con las reglas del proyecto sin fricciones: seguridad por filas (solo el alumno y el tutor "
    "de esa reserva ven su chat), fechas en UTC y reutilizacion de los generadores de codigo que ya "
    "tenemos. No toca el modulo de pagos.", st_body)]

# Estimado A
story += [Paragraph("Estimacion de tiempo - Chat", st_h2)]
estA = Table([
    [Paragraph("<b>Tarea</b>", st_cellh), Paragraph("<b>Dias</b>", st_cellh)],
    [Paragraph("Tabla de mensajes + seguridad + ventana de \"2 dias antes\"", st_cell), Paragraph("0.5", st_cell)],
    [Paragraph("Conexion en tiempo real y envio de mensajes", st_cell), Paragraph("1.0", st_cell)],
    [Paragraph("Panel de chat junto al video", st_cell), Paragraph("1.0", st_cell)],
    [Paragraph("Exportar / descargar la conversacion", st_cell), Paragraph("0.5", st_cell)],
    [Paragraph("Retencion y borrado automatico a los 30 dias", st_cell), Paragraph("0.5", st_cell)],
    [Paragraph("Pruebas e integracion en la pantalla de sesion", st_cell), Paragraph("0.5 - 1.0", st_cell)],
    [Paragraph("<b>Total</b>", st_cellb), Paragraph("<b>~3.5 - 5 dias (~1 semana)</b>", st_cellb)],
], colWidths=[128*mm, 34*mm])
estA.setStyle(TableStyle([
    ("BACKGROUND",(0,0),(-1,0), HEADBG),
    ("ROWBACKGROUNDS",(0,1),(-1,-2), [colors.white, LIGHTBG]),
    ("BACKGROUND",(0,-1),(-1,-1), colors.HexColor("#e7f3ec")),
    ("GRID",(0,0),(-1,-1),0.5, LINE),
    ("ALIGN",(1,0),(1,-1),"CENTER"),
    ("VALIGN",(0,0),(-1,-1),"MIDDLE"),
    ("LEFTPADDING",(0,0),(-1,-1),6),("RIGHTPADDING",(0,0),(-1,-1),6),
    ("TOPPADDING",(0,0),(-1,-1),4),("BOTTOMPADDING",(0,0),(-1,-1),4),
]))
story += [estA, Spacer(1,4)]

# ---------- Integracion B ----------
story += [Paragraph("Integracion B &mdash; Grabacion de la videollamada", st_h1), hr()]
story += [chip("COMPLEJIDAD MEDIA", AMBER), Spacer(1,6)]

story += [Paragraph("Por que es otra cosa", st_h2)]
story += [Paragraph(
    "Cuando el cliente dice \"...los proximos 30 dias <b>en los que se guarda la llamada</b>...\" asume "
    "que la videollamada se graba. Hoy <b>no se graba nada</b>: el sistema solo crea una sala de video "
    "temporal y, al terminar, no queda registro. Grabar el video es una funcion nueva que implica:", st_body)]

callout = Table([[Paragraph(
    "&bull; <b>Coste de proveedor:</b> la grabacion en la nube de Daily es un add-on <b>de pago</b> "
    "(ya marcado como riesgo de coste en nuestra documentacion de riesgos).<br/>"
    "&bull; <b>Almacenamiento:</b> los videos pesan; guardarlos 30 dias suma coste mensual de almacenamiento.<br/>"
    "&bull; <b>Privacidad / consentimiento:</b> grabar a las personas exige aviso y aceptacion explicita "
    "de alumno y tutor (tema legal, no solo tecnico).<br/>"
    "&bull; <b>Decision pendiente:</b> es una funcion fuera del alcance actual del MVP; hay que decidir "
    "si entra y con que reglas.", st_callout)]], colWidths=[doc.width])
callout.setStyle(TableStyle([
    ("BACKGROUND",(0,0),(-1,-1), colors.HexColor("#fff8ec")),
    ("LINEBEFORE",(0,0),(0,-1), 3, AMBER),
    ("LEFTPADDING",(0,0),(-1,-1),12),("RIGHTPADDING",(0,0),(-1,-1),12),
    ("TOPPADDING",(0,0),(-1,-1),9),("BOTTOMPADDING",(0,0),(-1,-1),9),
]))
story += [callout, Spacer(1,8)]

story += [Paragraph("Que implicaria si se aprueba", st_h2)]
story += [Paragraph(
    "Tecnicamente es alcanzable: se activa la grabacion en la nube del proveedor, se recibe el aviso de "
    "\"grabacion lista\", se guarda el enlace contra la sesion y se expone un boton de descarga con la "
    "misma regla de retencion de 30 dias. La complejidad es <b>media</b> mas por el coste, el "
    "almacenamiento y el consentimiento que por el codigo en si.", st_body)]

story += [Paragraph("Estimacion de tiempo - Grabacion", st_h2)]
estB = Table([
    [Paragraph("<b>Tarea</b>", st_cellh), Paragraph("<b>Dias</b>", st_cellh)],
    [Paragraph("Activar grabacion en la nube + recibir aviso de \"video listo\"", st_cell), Paragraph("1.0 - 1.5", st_cell)],
    [Paragraph("Guardar enlace del video y exponerlo en la pantalla de sesion", st_cell), Paragraph("1.0", st_cell)],
    [Paragraph("Descarga + retencion/borrado a los 30 dias", st_cell), Paragraph("1.0", st_cell)],
    [Paragraph("Aviso y consentimiento de grabacion (alumno y tutor)", st_cell), Paragraph("1.0", st_cell)],
    [Paragraph("Pruebas e integracion", st_cell), Paragraph("1.0", st_cell)],
    [Paragraph("<b>Total (si el cliente lo aprueba)</b>", st_cellb), Paragraph("<b>~1 - 1.5 semanas</b>", st_cellb)],
], colWidths=[128*mm, 34*mm])
estB.setStyle(TableStyle([
    ("BACKGROUND",(0,0),(-1,0), HEADBG),
    ("ROWBACKGROUNDS",(0,1),(-1,-2), [colors.white, LIGHTBG]),
    ("BACKGROUND",(0,-1),(-1,-1), colors.HexColor("#fdf1dd")),
    ("GRID",(0,0),(-1,-1),0.5, LINE),
    ("ALIGN",(1,0),(1,-1),"CENTER"),
    ("VALIGN",(0,0),(-1,-1),"MIDDLE"),
    ("LEFTPADDING",(0,0),(-1,-1),6),("RIGHTPADDING",(0,0),(-1,-1),6),
    ("TOPPADDING",(0,0),(-1,-1),4),("BOTTOMPADDING",(0,0),(-1,-1),4),
]))
story += [estB, Spacer(1,4)]
story += [Paragraph(
    "<i>Nota: este estimado no incluye el coste recurrente del add-on de grabacion ni del almacenamiento, "
    "que son gastos operativos mensuales, no horas de desarrollo.</i>", st_small)]

# ---------- Recomendacion ----------
story += [Paragraph("Recomendacion y proximos pasos", st_h1), hr()]
rec = Table([
    [Paragraph("1", st_cellh),
     Paragraph("<b>Confirmar con el cliente: ¿chat o grabacion de video?</b> Sospechamos que confunde "
               "ambas. El chat es barato e inmediato; grabar el video es una funcion aparte, de pago y "
               "con implicaciones legales.", st_cell)],
    [Paragraph("2", st_cellh),
     Paragraph("<b>Arrancar ya la Integracion A (chat).</b> Cumple los cuatro requisitos, encaja en el "
               "stack actual y se entrega en ~1 semana sin costes nuevos.", st_cell)],
    [Paragraph("3", st_cellh),
     Paragraph("<b>Tratar la Integracion B (grabacion) como decision aparte.</b> Si el cliente la quiere, "
               "se cotiza con su coste de proveedor + almacenamiento y se planifica el consentimiento.", st_cell)],
], colWidths=[10*mm, 152*mm])
rec.setStyle(TableStyle([
    ("BACKGROUND",(0,0),(0,-1), BRAND),
    ("TEXTCOLOR",(0,0),(0,-1), colors.white),
    ("ROWBACKGROUNDS",(1,0),(1,-1), [colors.white, LIGHTBG]),
    ("GRID",(0,0),(-1,-1),0.5, LINE),
    ("VALIGN",(0,0),(-1,-1),"MIDDLE"),
    ("ALIGN",(0,0),(0,-1),"CENTER"),
    ("FONTNAME",(0,0),(0,-1),"Helvetica-Bold"),
    ("FONTSIZE",(0,0),(0,-1),12),
    ("LEFTPADDING",(0,0),(-1,-1),8),("RIGHTPADDING",(0,0),(-1,-1),8),
    ("TOPPADDING",(0,0),(-1,-1),7),("BOTTOMPADDING",(0,0),(-1,-1),7),
]))
story += [rec]

doc.build(story)
print("OK ->", OUT)
