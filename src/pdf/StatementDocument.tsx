import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { bpToPct, formatINR } from "../engine";
import { LOGO_ASPECT } from "../lib/brand";
import type { StatementData } from "./types";

const C = { ink: "#0f172a", muted: "#64748b", line: "#e2e8f0", brand: "#4338ca", soft: "#eef2ff", warn: "#92400e", warnBg: "#fef3c7" };

const s = StyleSheet.create({
  page: { fontFamily: "Body", fontSize: 9, color: C.ink, paddingTop: 36, paddingBottom: 54, paddingHorizontal: 36 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", borderBottomWidth: 2, borderBottomColor: C.brand, paddingBottom: 8, marginBottom: 14 },
  brand: { fontSize: 18, fontWeight: 700, color: C.brand },
  title: { fontSize: 12, fontWeight: 700 },
  meta: { fontSize: 8, color: C.muted, textAlign: "right" },
  h2: { fontSize: 11, fontWeight: 700, marginTop: 14, marginBottom: 6, color: C.brand },
  table: { borderWidth: 1, borderColor: C.line, borderRadius: 3 },
  tr: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: C.line },
  trLast: { flexDirection: "row" },
  th: { backgroundColor: C.soft, fontWeight: 700 },
  td: { paddingVertical: 4, paddingHorizontal: 5 },
  right: { textAlign: "right" },
  bold: { fontWeight: 700 },
  muted: { color: C.muted },
  kv: { flexDirection: "row", marginBottom: 3 },
  kvK: { width: 110, color: C.muted },
  notice: { backgroundColor: C.warnBg, color: C.warn, padding: 6, borderRadius: 3, marginBottom: 8, fontSize: 8 },
  sig: { flexDirection: "row", justifyContent: "space-between", marginTop: 36 },
  sigBox: { width: "42%", borderTopWidth: 1, borderTopColor: C.ink, paddingTop: 4, fontSize: 8, color: C.muted },
  footer: { position: "absolute", bottom: 22, left: 36, right: 36, flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: C.muted },
});

/** Call once before rendering. Takes react-pdf's Font so this file stays free of asset imports. */
export function registerStatementFonts(
  Font: {
    register: (o: { family: string; fonts: { src: string; fontWeight: number }[] }) => void;
    registerHyphenationCallback: (cb: (w: string) => string[]) => void;
  },
  regularSrc: string,
  boldSrc: string,
): void {
  Font.register({
    family: "Body",
    fonts: [
      { src: regularSrc, fontWeight: 400 },
      { src: boldSrc, fontWeight: 700 },
    ],
  });
  Font.registerHyphenationCallback((w) => [w]);
}

interface Col {
  w: number; // flex weight
  right?: boolean;
}

function Table({ cols, head, rows, foot }: { cols: Col[]; head: string[]; rows: string[][]; foot?: string[] }) {
  const cell = (text: string, i: number, bold?: boolean) => (
    <Text
      key={i}
      style={[s.td, { flex: cols[i].w }, cols[i].right ? s.right : {}, bold ? s.bold : {}]}
    >
      {text}
    </Text>
  );
  return (
    <View style={s.table}>
      <View style={[s.tr, s.th]}>{head.map((h, i) => cell(h, i, true))}</View>
      {rows.map((r, ri) => (
        <View key={ri} style={ri === rows.length - 1 && !foot ? s.trLast : s.tr} wrap={false}>
          {r.map((t, i) => cell(t, i))}
        </View>
      ))}
      {foot && <View style={[s.trLast, { backgroundColor: "#f8fafc" }]}>{foot.map((t, i) => cell(t, i, true))}</View>}
    </View>
  );
}

function H2({ children, first }: { children: string; first?: boolean }) {
  return (
    <Text style={[s.h2, first ? { marginTop: 0 } : {}]} minPresenceAhead={90}>
      {children}
    </Text>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <View style={s.kv}>
      <Text style={s.kvK}>{k}</Text>
      <Text style={s.bold}>{v}</Text>
    </View>
  );
}

const dateOnly = (iso: string) => iso.slice(0, 10);
const money = formatINR;

export function StatementDocument({ data }: { data: StatementData }) {
  const { result: r, rules } = data;
  const isSettlement = data.kind === "settlement";
  const title = isSettlement ? "Project Settlement Statement" : "Calculation Report";

  const empTotal = data.employees.reduce((a, e) => a + e.paise, 0);
  const extraTotal = data.employees.reduce((a, e) => a + e.extraPaise, 0);
  const recTotal = data.employees.reduce((a, e) => a + e.recoveredPaise, 0);
  const outTotal = data.employees.reduce((a, e) => a + e.outstandingPaise, 0);
  const hasExtras = data.extras.length > 0;

  const steps: string[][] = [["1", data.basisLabel, "Amount the split is based on", money(r.grossPaise)]];
  if (rules.gst.enabled) steps.push(["", "GST", `${bpToPct(rules.gst.rateBp)}% (included in payment)`, `- ${money(r.gstPaise)}`]);
  if (rules.tds.enabled) steps.push(["", "TDS", `${bpToPct(rules.tds.rateBp)}% deducted by client`, `- ${money(r.tdsPaise)}`]);
  steps.push(
    ["2", "Net distributable", rules.gst.enabled || rules.tds.enabled ? "Payment minus GST and TDS" : "No tax deducted", money(r.netPaise)],
    ["3", "Company share", `${bpToPct(rules.companyBp)}% of net`, money(r.companySharePaise)],
    ["", "Employee pool", `${bpToPct(10000 - rules.companyBp)}% of net`, money(r.employeePoolPaise)],
    ["4", "Company reserve", `${bpToPct(rules.reserveBp)}% of company share`, money(r.reservePaise)],
    ["", "Founders pool", `${bpToPct(10000 - rules.reserveBp)}% of company share`, money(r.foundersPoolPaise)],
  );

  return (
    <Document title={`${title}${data.project ? ` - ${data.project.name}` : ""}`} author="Scaltrix">
      <Page size="A4" style={s.page}>
        <View style={s.header} fixed>
          <View>
            {data.logoSrc ? (
              <Image src={data.logoSrc} style={{ height: 48, width: 48 * LOGO_ASPECT, marginBottom: 4 }} />
            ) : (
              <Text style={s.brand}>Scaltrix</Text>
            )}
            <Text style={s.title}>{title}</Text>
          </View>
          <View>
            <Text style={s.meta}>Generated {dateOnly(data.generatedAt)}</Text>
            {data.revision != null && <Text style={s.meta}>Revision {data.revision}</Text>}
            {data.preparedBy && <Text style={s.meta}>Prepared by {data.preparedBy}</Text>}
          </View>
        </View>

        {data.whatIf && (
          <Text style={s.notice}>
            What-if calculation: these figures use values entered in the calculator and may differ from the payments and
            team saved on the project.
          </Text>
        )}

        <H2 first>{data.project ? "Project overview" : "Calculation basis"}</H2>
        {data.project ? (
          <View>
            <KV k="Project" v={data.project.name} />
            <KV k="Client" v={data.project.client ?? "-"} />
            <KV k="Agreed price" v={money(data.project.pricePaise)} />
            <KV k="Received so far" v={money(data.project.receivedPaise)} />
            <KV k="Balance" v={money(data.project.pricePaise - data.project.receivedPaise)} />
            <KV k="Calculated on" v={`${data.basisLabel} (${money(r.grossPaise)})`} />
          </View>
        ) : (
          <View>
            <KV k="Calculated on" v={`${data.basisLabel} (${money(r.grossPaise)})`} />
          </View>
        )}
        <Text style={[s.muted, { marginTop: 2 }]}>
          Rules used: {rules.fromSnapshot ? "saved on the project at its first payment" : "current Settings"}.
        </Text>

        <H2>How the money is divided</H2>
        <Table
          cols={[{ w: 0.5 }, { w: 2 }, { w: 3 }, { w: 2, right: true }]}
          head={["Step", "Item", "Rule", "Amount"]}
          rows={steps}
        />

        <H2>Founder payouts</H2>
        <Table
          cols={[{ w: 3 }, { w: 1, right: true }, { w: 2, right: true }]}
          head={["Founder", "Weight", "Amount"]}
          rows={r.founderPayouts.map((f) => [f.name, `${bpToPct(f.weightBp)}%`, money(f.paise)])}
          foot={["Total", "", money(r.founderPayouts.reduce((a, f) => a + f.paise, 0))]}
        />

        <H2>Employee salary distribution</H2>
        {data.employees.length === 0 ? (
          <Text style={s.muted}>No employees assigned.</Text>
        ) : (
          <>
            <Table
              cols={
                hasExtras
                  ? [{ w: 2 }, { w: 1.7 }, { w: 0.8, right: true }, { w: 1, right: true }, { w: 1.7, right: true }, { w: 1.5, right: true }, { w: 1.5, right: true }, { w: 1.7, right: true }]
                  : [{ w: 3 }, { w: 2.5 }, { w: 1, right: true }, { w: 1, right: true }, { w: 2, right: true }]
              }
              head={
                hasExtras
                  ? ["Employee", "Role", "Score", "Share", "Amount", "Extra given", "Recovered", "Outstanding"]
                  : ["Employee", "Role", "Score", "Share", "Amount"]
              }
              rows={data.employees.map((e) =>
                hasExtras
                  ? [e.name, e.role || "-", String(e.score), `${bpToPct(e.shareBp).toFixed(2)}%`, money(e.paise), money(e.extraPaise), money(e.recoveredPaise), money(e.outstandingPaise)]
                  : [e.name, e.role || "-", String(e.score), `${bpToPct(e.shareBp).toFixed(2)}%`, money(e.paise)],
              )}
              foot={
                hasExtras
                  ? ["Total", "", "", "100%", money(empTotal), money(extraTotal), money(recTotal), money(outTotal)]
                  : ["Total", "", "", "100%", money(empTotal)]
              }
            />
            <Text style={[s.muted, { marginTop: 3 }]}>
              Share is each person's score divided by the total score. Whoever contributed most receives the largest share.
            </Text>
          </>
        )}

        {hasExtras && (
          <>
            <H2>Extra payouts and recovery</H2>
            <Table
              cols={[{ w: 2 }, { w: 1.3 }, { w: 1.6, right: true }, { w: 1.6, right: true }, { w: 1, right: true }, { w: 2.2 }, { w: 1.6, right: true }]}
              head={["Employee", "Given on", "Base share", "Extra", "Extra %", "Recovery plan", "Outstanding"]}
              rows={data.extras.map((x) => [
                x.employee,
                x.givenOn,
                x.basePaise == null ? "-" : money(x.basePaise),
                money(x.extraPaise),
                x.extraBp == null ? "-" : `${bpToPct(x.extraBp).toFixed(2)}%`,
                x.plan,
                money(x.outstandingPaise),
              ])}
            />
          </>
        )}

        {data.payments.length > 0 && (
          <>
            <H2>Client payments received</H2>
            <Table
              cols={[{ w: 1.5 }, { w: 2, right: true }, { w: 1.5, right: true }, { w: 1.5, right: true }, { w: 3 }]}
              head={["Date", "Amount", "GST", "TDS", "Note"]}
              rows={data.payments.map((p) => [p.date, money(p.amountPaise), money(p.gstPaise), money(p.tdsPaise), p.note ?? ""])}
              foot={["Total", money(data.payments.reduce((a, p) => a + p.amountPaise, 0)), "", "", ""]}
            />
          </>
        )}

        {data.attachments.length > 0 && (
          <>
            <H2>Linked documents</H2>
            {data.attachments.map((a, i) => (
              <Text key={i} style={{ marginBottom: 2 }}>
                {i + 1}. {a}
              </Text>
            ))}
          </>
        )}

        <View style={s.sig} wrap={false}>
          <Text style={s.sigBox}>Prepared by{data.preparedBy ? `: ${data.preparedBy}` : ""}</Text>
          <Text style={s.sigBox}>Approved by (founder signature)</Text>
        </View>

        <View style={s.footer} fixed>
          <Text>Scaltrix · Internal and confidential. Not for sharing with clients.</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
