// node sheets/tests/formula.test.js — formula engine checked against known Excel results.
const assert = require('assert');
const M = require('../js/model.js');
const F = M.F, Fmt = F.Fmt;
let pass = 0, fail = 0; const fails = [];
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; fails.push(name + ': ' + e.message); } };

/* ---------- fixture workbook ---------- */
const wb = M.Workbook.blank(2);
wb.renameSheet(wb.sheets[0], 'Data');
wb.renameSheet(wb.sheets[1], 'Other Sheet');
const D = wb.sheets[0], O = wb.sheets[1];
const put = (sheet, a1, values) => { const p = F.parseAddr(a1); values.forEach((v, i) => { if (Array.isArray(v)) v.forEach((x, j) => set(sheet, p.r + i, p.c + j, x)); else set(sheet, p.r + i, p.c, v); }); };
const set = (sheet, r, c, v) => { if (typeof v === 'string' && v[0] === '=') wb.setCell(sheet, r, c, { f: v.slice(1) }); else wb.setCell(sheet, r, c, { v }); };
wb.transact('fixture', () => {
  put(D, 'A1', [2, 4, 4, 4, 5, 5, 7, 9]);
  put(D, 'B1', ['apples', 'oranges', 'peaches', 'apples']); put(D, 'C1', [32, 54, 75, 86]);
  put(D, 'D1', [100000, 200000, 300000, 400000]); put(D, 'E1', [7000, 14000, 21000, 28000]);
  put(D, 'F1', [Fmt.dateToSerial(2008, 1, 1), Fmt.dateToSerial(2008, 3, 1), Fmt.dateToSerial(2008, 10, 30), Fmt.dateToSerial(2009, 2, 15), Fmt.dateToSerial(2009, 4, 1)]);
  put(D, 'G1', [-10000, 2750, 4250, 3250, 2750]);
  put(D, 'H1', [[1, 'a'], [5, 'b'], [10, 'c']]);
  put(D, 'J1', [4.14, 4.19, 5.17, 5.77, 6.39]); put(D, 'K1', ['red', 'orange', 'yellow', 'green', 'blue']);
  put(D, 'L1', [25, 38, 40, 41]);
  put(D, 'N1', [['Region', 'Product', 'Amount'], ['East', 'Apple', 100], ['West', 'Apple', 250], ['East', 'Pear', 75], ['East', 'Apple', 30], ['North', 'Pear', 200], ['West', 'Pear', 60]]);
  put(D, 'R1', [-70000, 12000, 15000, 18000, 21000, 26000]);
  put(D, 'S1', ['text', true, 3, '', null, 7]);
  put(O, 'A1', [10, 20, 30]);
});
const ev = f => wb.calc(f, D, 19, 19);
const approx = (a, b, tol = 1e-6) => { if (typeof a !== 'number') throw new Error(`got ${a && a.code || JSON.stringify(a)}, want ${b}`); if (Math.abs(a - b) > tol * Math.max(1, Math.abs(b))) throw new Error(`got ${a}, want ${b}`); };
const eq = (f, want, tol) => t(f, () => {
  const got = ev(f);
  if (typeof want === 'number') approx(got, want, tol);
  else if (want && want.err) { if (!(got instanceof F.FErr) || got.code !== want.err) throw new Error(`got ${JSON.stringify(got && got.code || got)}, want ${want.err}`); }
  else assert.deepStrictEqual(got, want);
});
const E = code => ({ err: code });

/* ---------- operators & parsing ---------- */
eq('=1+2*3', 7); eq('=(1+2)*3', 9); eq('=-2^2', 4); eq('=2^3^2', 64); eq('=10%', 0.1); eq('=50%*200', 100);
eq('="a"&1&TRUE', 'a1TRUE'); eq('=1/3&""', '0.333333333333333'); eq('=1/0', E('#DIV/0!')); eq('="x"+1', E('#VALUE!'));
eq('="3"+4', 7); eq('="a"<"B"', true); eq('=1<"a"', true); eq('="abc"="ABC"', true); eq('=TRUE>1', true); eq('=2<>2', false);
eq('={1,2;3,4}', [[1, 2], [3, 4]]); eq('=SUM({1,2;3,4}*2)', 20); eq('=SUM(A1:A3*{1;2;3})', 2 + 8 + 12);
eq('=NOSUCHFN(1)', E('#NAME?')); eq('=undefinedName+1', E('#NAME?')); eq('=SUM(A1:A8 )', 40);
eq("='Other Sheet'!A2*2", 40); eq("=SUM('Other Sheet'!A1:A3)", 60); eq('=SUM(A:A)', 40); eq('=SUM(1:1)', 2 + 32 + 100000 + 7000 + Fmt.dateToSerial(2008, 1, 1) - 10000 + 1 + 4.14 + 25 - 70000);
eq('=SUM(A1:INDEX(A1:A8,3))', 10); eq('=ROWS(A1:A8:C2)', 8);
t('parse errors are reported', () => { assert.throws(() => F.parse('=SUM(1,'), F.ParseError); assert.throws(() => F.parse('=1+'), F.ParseError); assert.throws(() => F.parse('="abc'), F.ParseError); });
t('LOG10( is a function, LOG10 a cell', () => { assert.strictEqual(F.parse('LOG10(100)').t, 'fn'); assert.strictEqual(F.parse('LOG10').t, 'ref'); });
t('_xlfn prefixes are ignored', () => { assert.strictEqual(F.parse('_xlfn.XLOOKUP(1,A1:A2,B1:B2)').name, 'XLOOKUP'); assert.strictEqual(F.parse('_xlfn._xlws.FILTER(A1:A2,B1:B2)').name, 'FILTER'); });

/* ---------- math ---------- */
eq('=SUM(1,2,3)', 6); eq('=SUM("3",TRUE)', 4); eq('=SUM(S1:S6)', 10); eq('=ROUND(2.5,0)', 3); eq('=ROUND(-2.5,0)', -3); eq('=ROUND(1.005,2)', 1.01);
eq('=ROUND(1234.5678,-2)', 1200); eq('=ROUNDUP(3.2,0)', 4); eq('=ROUNDUP(-3.2,0)', -4); eq('=ROUNDDOWN(-3.7,0)', -3); eq('=ROUNDUP(3.14159,3)', 3.142);
eq('=MOD(-3,2)', 1); eq('=MOD(3,-2)', -1); eq('=MOD(5,0)', E('#DIV/0!')); eq('=INT(-8.9)', -9); eq('=TRUNC(-8.9)', -8); eq('=TRUNC(8.987,2)', 8.98);
eq('=CEILING(2.5,1)', 3); eq('=CEILING(-2.5,-2)', -4); eq('=CEILING(-2.5,2)', -2); eq('=CEILING(1.5,0.1)', 1.5); eq('=FLOOR(-2.5,-2)', -2); eq('=FLOOR(2.5,2)', 2); eq('=FLOOR(3.7,2)', 2);
eq('=CEILING.MATH(-5.5,2,-1)', -6); eq('=CEILING.MATH(24.3,5)', 25); eq('=FLOOR.MATH(-8.1,2)', -10); eq('=MROUND(10,3)', 9); eq('=MROUND(-10,-3)', -9); eq('=MROUND(5,-2)', E('#NUM!'));
eq('=EVEN(1.5)', 2); eq('=EVEN(-1)', -2); eq('=ODD(2)', 3); eq('=ODD(-1)', -1); eq('=FACT(5)', 120); eq('=FACTDOUBLE(7)', 105); eq('=COMBIN(8,2)', 28); eq('=PERMUT(100,3)', 970200);
eq('=GCD(24,36)', 12); eq('=LCM(4,6)', 12); eq('=POWER(2,10)', 1024); eq('=SQRT(16)', 4); eq('=SQRT(-1)', E('#NUM!')); eq('=LOG(8,2)', 3); eq('=LN(EXP(1))', 1); eq('=LOG10(1000)', 3);
eq('=ABS(-5)', 5); eq('=SIGN(-3)', -1); eq('=PI()', Math.PI); eq('=SUMPRODUCT({1,2,3},{4,5,6})', 32); eq('=SUMPRODUCT((N2:N7="East")*(P2:P7))', 205); eq('=SUMSQ(3,4)', 25); eq('=PRODUCT(2,3,4)', 24);
eq('=QUOTIENT(-10,3)', -3); eq('=ROMAN(1999)', 'MCMXCIX'); eq('=ARABIC("MCMXCIX")', 1999); eq('=DEC2BIN(10)', '1010'); eq('=DEC2BIN(-1)', '1111111111'); eq('=HEX2DEC("FF")', 255);
eq('=DEC2HEX(255,4)', '00FF'); eq('=BIN2DEC("1111111111")', -1); eq('=BASE(255,16)', 'FF'); eq('=DECIMAL("FF",16)', 255); eq('=MDETERM({1,2;3,4})', -2);
eq('=MMULT({1,2;3,4},{5;6})', [[17], [39]]); eq('=MINVERSE({4,7;2,6})', [[0.6, -0.7], [-0.2, 0.4]]); eq('=DEGREES(PI())', 180); eq('=RADIANS(180)', Math.PI); eq('=ATAN2(1,1)', Math.PI / 4);
eq('=SIN(PI()/2)', 1); eq('=COS(0)', 1); eq('=SUMX2MY2({2,3},{1,1})', 11); eq('=SEQUENCE(2,3,10,5)', [[10, 15, 20], [25, 30, 35]]);

/* ---------- statistics ---------- */
eq('=AVERAGE(A1:A8)', 5); eq('=STDEV.P(A1:A8)', 2); eq('=STDEV.S(A1:A8)', 2.13808993529939); eq('=STDEV(A1:A8)', 2.13808993529939); eq('=VAR.S(A1:A8)', 4.571428571); eq('=VAR.P(A1:A8)', 4);
eq('=MEDIAN(A1:A8)', 4.5); eq('=MODE(A1:A8)', 4); eq('=LARGE(A1:A8,2)', 7); eq('=SMALL(A1:A8,3)', 4); eq('=PERCENTILE.INC(A1:A8,0.25)', 4); eq('=QUARTILE(A1:A8,3)', 5.5);
eq('=PERCENTILE.EXC(A1:A8,0.25)', 4); eq('=PERCENTILE(A1:A8,0.9)', 7.6); eq('=RANK(5,A1:A8)', 3); eq('=RANK(5,A1:A8,1)', 5); eq('=RANK.AVG(4,A1:A8)', 6); eq('=GEOMEAN(2,8)', 4); eq('=HARMEAN(1,2,4)', 1.714285714);
eq('=AVEDEV(A1:A8)', 1.5); eq('=DEVSQ(A1:A8)', 32); eq('=COUNT(A1:A8,"x",1)', 9); eq('=COUNT(S1:S6)', 2); eq('=COUNTA(S1:S6)', 5); eq('=COUNTBLANK(S1:S6)', 2); eq('=MAX(A1:A8)', 9); eq('=MIN(A1:A8)', 2);
eq('=MAX(S1:S1)', 0); eq('=AVERAGE(S1:S1)', E('#DIV/0!')); eq('=AVERAGEA(S1:S3)', 4 / 3); eq('=MAXA(S1:S2)', 1);
eq('=SLOPE({2,3,9,1,8,7,5},{6,5,11,7,5,4,4})', 0.305555556); eq('=INTERCEPT({2,3,9,1,8},{6,5,11,7,5})', 0.048387097); eq('=CORREL({3,2,4,5,6},{9,7,12,15,17})', 0.997054486);
eq('=RSQ({2,4,6},{1,2,3})', 1); eq('=FORECAST(30,{6,7,9,15,21},{20,28,31,38,40})', 10.607253); eq('=PEARSON({9,7,5,3,1},{10,6,1,5,3})', 0.699379);
eq('=NORM.DIST(42,40,1.5,TRUE)', 0.9087888, 1e-6); eq('=NORM.DIST(42,40,1.5,FALSE)', 0.10934005, 1e-6); eq('=NORM.S.DIST(1.333333,TRUE)', 0.908788726, 1e-6);
eq('=NORM.INV(0.908789,40,1.5)', 42.000002, 1e-6); eq('=NORM.S.INV(0.908789)', 1.3333347, 1e-6); eq('=STANDARDIZE(42,40,1.5)', 1.333333333);
eq('=COVARIANCE.P({3,2,4,5,6},{9,7,12,15,17})', 5.2); eq('=COVARIANCE.S({2,4,8},{5,11,12})', 9.666666667); eq('=TRIMMEAN({4,5,6,7,2,3,4,5,1,2,3},0.2)', 3.777777778);
eq('=SKEW({3,4,5,2,3,4,5,6,4,7})', 0.359543); eq('=KURT({3,4,5,2,3,4,5,6,4,7})', -0.151799637); eq('=BINOM.DIST(6,10,0.5,FALSE)', 0.205078125); eq('=POISSON.DIST(2,5,TRUE)', 0.124652);
eq('=EXPON.DIST(0.2,10,TRUE)', 0.864664717); eq('=GAMMALN(4)', Math.log(6)); eq('=FREQUENCY({79,85,78,85,50,81,95,88,97},{70,79,89})', [[1], [2], [4], [2]]);
eq('=MODE.MULT({1,2,3,4,3,2,1,2,3})', [[2], [3]]); eq('=PERCENTRANK({13,12,11,8,4,3,2,1,1,1},2)', 0.333);

/* ---------- conditional aggregates ---------- */
eq('=COUNTIF(B1:B4,"apples")', 2); eq('=COUNTIF(C1:C4,">55")', 2); eq('=COUNTIF(B1:B4,"*es")', 4); eq('=COUNTIF(B1:B4,"?????es")', 2); eq('=COUNTIF(B1:B4,"<>apples")', 2);
eq('=COUNTIF(C1:C4,"<="&C2)', 2); eq('=COUNTIF(S1:S6,"")', 2); eq('=COUNTIF(A1:A8,4)', 3);
eq('=SUMIF(D1:D4,">160000",E1:E4)', 63000); eq('=SUMIF(D1:D4,">160000")', 900000); eq('=SUMIF(D1:D4,300000,E1:E4)', 21000); eq('=SUMIF(B1:B4,"apples",C1)', 118);
eq('=SUMIFS(P2:P7,N2:N7,"East",O2:O7,"Apple")', 130); eq('=SUMIFS(P2:P7,N2:N7,"<>East",P2:P7,">=100")', 450); eq('=COUNTIFS(N2:N7,"East",P2:P7,">50")', 2);
eq('=AVERAGEIF(N2:N7,"West",P2:P7)', 155); eq('=AVERAGEIFS(P2:P7,O2:O7,"Pear")', 335 / 3); eq('=MAXIFS(P2:P7,N2:N7,"East")', 100); eq('=MINIFS(P2:P7,O2:O7,"Pear")', 60);
eq('=AVERAGEIF(N2:N7,"South",P2:P7)', E('#DIV/0!')); eq('=SUMIFS(P:P,N:N,"West")', 310);

/* ---------- logical ---------- */
eq('=IF(1>2,"a","b")', 'b'); eq('=IF(TRUE,5)', 5); eq('=IF(FALSE,5)', false); eq('=IF({1,0},"y","n")', [['y', 'n']]); eq('=IFS(5>9,"a",5>3,"b")', 'b'); eq('=IFS(FALSE,1)', E('#N/A'));
eq('=IFERROR(1/0,"x")', 'x'); eq('=IFERROR(7,"x")', 7); eq('=IFNA(NA(),"x")', 'x'); eq('=IFNA(1/0,"x")', E('#DIV/0!')); eq('=AND(TRUE,1)', true); eq('=AND(A1:A3>1)', true); eq('=OR(FALSE,0)', false);
eq('=XOR(TRUE,TRUE)', false); eq('=XOR(TRUE,FALSE)', true); eq('=NOT(0)', true); eq('=SWITCH(2,1,"a",2,"b","c")', 'b'); eq('=SWITCH(9,1,"a","c")', 'c'); eq('=LET(x,2,y,3,x*y)', 6); eq('=LET(x,A1:A8,SUM(x)/COUNT(x))', 5);
eq('=CHOOSE(2,"a","b","c")', 'b'); eq('=CHOOSE(4,"a","b")', E('#VALUE!')); eq('=IF(1,1/0,2)', E('#DIV/0!')); eq('=IF(0,1/0,2)', 2);

/* ---------- lookup ---------- */
eq('=VLOOKUP(7,H1:I3,2)', 'b'); eq('=VLOOKUP(10,H1:I3,2,TRUE)', 'c'); eq('=VLOOKUP(0,H1:I3,2)', E('#N/A')); eq('=VLOOKUP(5,H1:I3,2,FALSE)', 'b'); eq('=VLOOKUP(6,H1:I3,2,FALSE)', E('#N/A'));
eq('=VLOOKUP(5,H1:I3,3,FALSE)', E('#REF!')); eq('=VLOOKUP("pea*",B1:C4,2,FALSE)', 75); eq('=HLOOKUP(5,{1,5,10;"x","y","z"},2,FALSE)', 'y');
eq('=MATCH(39,L1:L4,1)', 2); eq('=MATCH(41,L1:L4,0)', 4); eq('=MATCH(40,L1:L4,-1)', E('#N/A')); eq('=MATCH("ORANGES",B1:B4,0)', 2); eq('=MATCH(3,{5,4,3,2},-1)', 3);
eq('=INDEX(H1:I3,2,2)', 'b'); eq('=INDEX({1,2;3,4},2,2)', 4); eq('=INDEX(H1:I3,0,1)', [[1], [5], [10]]); eq('=INDEX(L1:L4,3)', 40); eq('=INDEX(H1:I3,5,1)', E('#REF!'));
eq('=INDEX(B1:B4,MATCH(86,C1:C4,0))', 'apples'); eq('=LOOKUP(4.19,J1:J5,K1:K5)', 'orange'); eq('=LOOKUP(5.75,J1:J5,K1:K5)', 'yellow'); eq('=LOOKUP(7.66,J1:J5,K1:K5)', 'blue'); eq('=LOOKUP(0,J1:J5,K1:K5)', E('#N/A'));
eq('=XLOOKUP("peaches",B1:B4,C1:C4)', 75); eq('=XLOOKUP("kiwi",B1:B4,C1:C4,"none")', 'none'); eq('=XLOOKUP("kiwi",B1:B4,C1:C4)', E('#N/A')); eq('=XLOOKUP("apples",B1:B4,C1:C4,,0,-1)', 86);
eq('=XLOOKUP(39,L1:L4,L1:L4,,-1)', 38); eq('=XLOOKUP(39,L1:L4,L1:L4,,1)', 40); eq('=XLOOKUP("or*",B1:B4,C1:C4,,2)', 54); eq('=XLOOKUP(5,H1:H3,H1:I3)', [[5, 'b']]);
eq('=XMATCH(40,L1:L4)', 3); eq('=XMATCH(39,L1:L4,1)', 3); eq('=XMATCH("apples",B1:B4,0,-1)', 4);
eq('=OFFSET(A1,2,2)', 75); eq('=SUM(OFFSET(A1,0,0,3,1))', 10); eq('=INDIRECT("C2")', 54); eq('=INDIRECT("\'Other Sheet\'!A3")', 30); eq('=INDIRECT("R2C3",FALSE)', 54);
eq('=ROW()', 20); eq('=COLUMN(C5)', 3); eq('=ROW(A3:A5)', [[3], [4], [5]]); eq('=ROWS(A1:A10)', 10); eq('=COLUMNS(H1:I3)', 2); eq('=ADDRESS(2,3)', '$C$2'); eq('=ADDRESS(2,3,2)', 'C$2');
eq('=ADDRESS(2,3,1,FALSE)', 'R2C3'); eq('=ADDRESS(2,3,1,TRUE,"Sheet 2")', "'Sheet 2'!$C$2"); eq('=TRANSPOSE({1,2,3})', [[1], [2], [3]]);
eq('=FILTER(N2:N7,P2:P7>99)', [['East'], ['West'], ['North']]); eq('=FILTER(N2:N7,P2:P7>999,"none")', 'none'); eq('=SORT({3;1;2})', [[1], [2], [3]]); eq('=SORT({3;1;2},1,-1)', [[3], [2], [1]]);
eq('=UNIQUE(N2:N7)', [['East'], ['West'], ['North']]); eq('=UNIQUE({1;2;2;3},,TRUE)', [[1], [3]]); eq('=SORTBY({"a";"b";"c"},{3;1;2})', [['b'], ['c'], ['a']]);
eq('=TAKE({1,2;3,4;5,6},2)', [[1, 2], [3, 4]]); eq('=DROP({1,2;3,4;5,6},2)', [[5, 6]]); eq('=VSTACK({1,2},{3,4})', [[1, 2], [3, 4]]); eq('=HSTACK({1;2},{3;4})', [[1, 3], [2, 4]]);

/* ---------- text ---------- */
eq('=LEFT("Sale Price",4)', 'Sale'); eq('=RIGHT("Stock Number",6)', 'Number'); eq('=RIGHT("abc")', 'c'); eq('=MID("Fluid Flow",7,20)', 'Flow'); eq('=LEN("Phoenix, AZ")', 11);
eq('=TRIM("  First Quarter   Earnings  ")', 'First Quarter Earnings'); eq('=PROPER("this is a TITLE")', 'This Is A Title'); eq('=PROPER("2-way street")', '2-Way Street'); eq('=PROPER("76BudGet")', '76Budget');
eq('=UPPER("total")', 'TOTAL'); eq('=LOWER("E. E. Cummings")', 'e. e. cummings'); eq('=SUBSTITUTE("Quarter 1, 2008","1","2",1)', 'Quarter 2, 2008'); eq('=SUBSTITUTE("Quarter 1, 2011","1","2",3)', 'Quarter 1, 2012');
eq('=SUBSTITUTE("Sales Data","Sales","Cost")', 'Cost Data'); eq('=REPLACE("abcdefghijk",6,5,"*")', 'abcde*k'); eq('=FIND("M","Miriam McGovern")', 1); eq('=FIND("m","Miriam McGovern")', 6);
eq('=FIND("M","Miriam McGovern",3)', 8); eq('=FIND("z","abc")', E('#VALUE!')); eq('=SEARCH("e","Statements",6)', 7); eq('=SEARCH("MARGIN","Profit Margin")', 8); eq('=SEARCH("p?ofit","Profit Margin")', 1);
eq('=TEXT(1234.567,"$#,##0.00")', '$1,234.57'); eq('=TEXT(0.285,"0.0%")', '28.5%'); eq('=TEXT(DATE(2024,3,5),"dddd, mmmm d, yyyy")', 'Tuesday, March 5, 2024'); eq('=TEXT(0.75,"h:mm AM/PM")', '6:00 PM');
eq('=TEXT(1234.5,"0.00E+00")', '1.23E+03'); eq('=TEXT(4.25,"# ?/?")', '4 1/4'); eq('=TEXT(5,"000")', '005'); eq('=TEXT(1234567,"#,##0,")', '1,235'); eq('=TEXT(-5,"0;(0)")', '(5)'); eq('=TEXT(0,"0;-0;""zero""")', 'zero');
eq('=TEXT(1.5,"[h]:mm")', '36:00'); eq('=TEXT(44927,"mmm-yy")', 'Jan-23'); eq('=TEXT(0.123,"0.0#")', '0.12'); eq('=TEXT(12,"#.##")', '12.'); eq('=TEXT(1234,"0000000")', '0001234'); eq('=TEXT(3.5,"$0.00 ""each""")', '$3.50 each');
eq('=TEXT(5551234567,"(000) 000-0000")', '(555) 123-4567'); eq('=TEXT(TIME(13,5,9),"hh:mm:ss")', '13:05:09'); eq('=TEXT(-1234.5,"#,##0.00")', '-1,234.50');
eq('=VALUE("$1,000")', 1000); eq('=VALUE("16:48:00")-VALUE("12:00:00")', 0.2); eq('=VALUE("abc")', E('#VALUE!')); eq('=NUMBERVALUE("2.500,27",",",".")', 2500.27); eq('=NUMBERVALUE("3.5%")', 0.035);
eq('=CONCAT("a",B1:B2,1)', 'aapplesoranges1'); eq('=CONCATENATE("The ","end")', 'The end'); eq('=TEXTJOIN(", ",TRUE,"a","","b")', 'a, b'); eq('=TEXTJOIN("-",FALSE,{"a","","b"})', 'a--b');
eq('=TEXTBEFORE("Little red riding hood\'s red hood.","hood")', 'Little red riding '); eq('=TEXTAFTER("Little red riding hood\'s red hood.","hood")', "'s red hood."); eq('=TEXTAFTER("a-b-c","-",-1)', 'c');
eq('=TEXTSPLIT("a,b;c,d",",",";")', [['a', 'b'], ['c', 'd']]); eq('=FIXED(1234.567,1)', '1,234.6'); eq('=FIXED(-1234.567,-1)', '-1,230'); eq('=FIXED(44.332,2,TRUE)', '44.33');
eq('=DOLLAR(1234.567,2)', '$1,234.57'); eq('=DOLLAR(-0.123,4)', '($0.1230)'); eq('=REPT("-",3)', '---'); eq('=EXACT("word","Word")', false); eq('=CHAR(65)', 'A'); eq('=CODE("A")', 65);
eq('=UNICHAR(9731)', '☃'); eq('=UNICODE("☃")', 9731); eq('=CLEAN("a"&CHAR(9)&"b")', 'ab'); eq('=T(1)', ''); eq('=T("x")', 'x'); eq('=N(TRUE)', 1); eq('=LEN(1/4)', 4);

/* ---------- date & time ---------- */
eq('=DATE(2008,14,2)', 39846); eq('=DATE(2008,1,-15)', 39432); eq('=DATE(108,1,2)', 39449); eq('=DATE(1900,2,28)', 59); eq('=DATE(1900,3,1)', 61); eq('=DATEVALUE("8/22/2011")', 40777);
eq('=DATEVALUE("2011-08-22")', 40777); eq('=DATEVALUE("22-Aug-2011")', 40777); eq('=YEAR(DATE(2024,7,4))', 2024); eq('=MONTH(DATE(2024,7,4))', 7); eq('=DAY(DATE(2024,7,4))', 4); eq('=YEAR("2024-07-04")', 2024);
eq('=WEEKDAY(DATE(2008,2,14))', 5); eq('=WEEKDAY(DATE(2008,2,14),2)', 4); eq('=WEEKDAY(DATE(2008,2,14),3)', 3); eq('=WEEKNUM(DATE(2012,3,9))', 10); eq('=WEEKNUM(DATE(2012,3,9),2)', 11);
eq('=ISOWEEKNUM(DATE(2012,3,9))', 10); eq('=ISOWEEKNUM(DATE(2021,1,1))', 53); eq('=EDATE(DATE(2011,1,15),-1)', 40527); eq('=EDATE(DATE(2011,1,31),1)', 40602); eq('=EOMONTH(DATE(2011,1,1),1)', 40602); eq('=EOMONTH(DATE(2011,1,1),-3)', 40482);
eq('=DATEDIF(DATE(2001,1,1),DATE(2003,1,1),"Y")', 2); eq('=DATEDIF(DATE(2001,6,1),DATE(2002,8,15),"D")', 440); eq('=DATEDIF(DATE(2001,6,1),DATE(2002,8,15),"YD")', 75); eq('=DATEDIF(DATE(2001,6,1),DATE(2002,8,15),"MD")', 14);
eq('=DATEDIF(DATE(2001,6,1),DATE(2002,8,15),"M")', 14); eq('=DATEDIF(DATE(2001,6,1),DATE(2002,8,15),"YM")', 2); eq('=NETWORKDAYS(DATE(2012,10,1),DATE(2013,3,1))', 110); eq('=NETWORKDAYS(DATE(2012,10,1),DATE(2013,3,1),DATE(2012,11,22))', 109);
eq('=WORKDAY(DATE(2008,10,1),151)', 39933); eq('=WORKDAY(DATE(2008,10,1),151,DATE({2008,2008,2009},{11,12,1},{26,4,21}))', 39938); eq('=WORKDAY(DATE(2024,1,8),-1)', Fmt.dateToSerial(2024, 1, 5));
eq('=YEARFRAC(DATE(2012,1,1),DATE(2012,7,30))', 0.580555556); eq('=YEARFRAC(DATE(2012,1,1),DATE(2012,7,30),1)', 0.576502732); eq('=YEARFRAC(DATE(2012,1,1),DATE(2012,7,30),3)', 0.578082192);
eq('=DAYS(DATE(2021,3,15),DATE(2021,2,1))', 42); eq('=DAYS("2021-03-15","2021-02-01")', 42); eq('=DAYS360(DATE(2011,1,30),DATE(2011,12,31))', 330); eq('=TIME(12,0,0)', 0.5); eq('=TIME(16,48,10)', 0.700115741);
eq('=HOUR(0.75)', 18); eq('=MINUTE(TIME(4,48,18))', 48); eq('=SECOND(TIME(4,48,18))', 18); eq('=HOUR("3:30 PM")', 15); eq('=TIMEVALUE("6:35 AM")', 0.274305556); eq('=TEXT(60,"yyyy-mm-dd")', '1900-02-29');
eq('=TEXT(1,"yyyy-mm-dd")', '1900-01-01'); eq('=TEXT(61,"d mmm yyyy")', '1 Mar 1900'); eq('=TEXT(45000.5,"m/d/yy h:mm")', '3/15/23 12:00');
t('TODAY/NOW use the clock (overridable)', () => { wb.nowOverride = 45000.25; assert.strictEqual(ev('=TODAY()'), 45000); assert.strictEqual(ev('=NOW()'), 45000.25); wb.nowOverride = null; });

/* ---------- information ---------- */
eq('=ISBLANK(S5)', true); eq('=ISBLANK(S4)', false); eq('=ISNUMBER(A1)', true); eq('=ISTEXT(B1)', true); eq('=ISNONTEXT(A1)', true); eq('=ISLOGICAL(S2)', true); eq('=ISERROR(1/0)', true);
eq('=ISERR(NA())', false); eq('=ISNA(NA())', true); eq('=ISEVEN(-1)', false); eq('=ISODD(5)', true); eq('=ISREF(A1)', true); eq('=ISREF("A1")', false); eq('=TYPE("a")', 2); eq('=TYPE({1,2})', 64);
eq('=ERROR.TYPE(1/0)', 2); eq('=ERROR.TYPE(NA())', 7); eq('=NA()', E('#N/A')); eq('=SHEET()', 1); eq('=SHEETS()', 2);

/* ---------- financial ---------- */
eq('=PMT(0.08/12,10,10000)', -1037.032089); eq('=PMT(0.06/12,18*12,0,50000)', -129.0811609); eq('=PMT(0,10,1000)', -100); eq('=FV(0.06/12,10,-200,-500,1)', 2581.403374); eq('=FV(0.12/12,12,-1000)', 12682.50301);
eq('=PV(0.08/12,12*20,500,,0)', -59777.14585); eq('=NPER(0.12/12,-100,-1000,10000,1)', 59.67386567); eq('=NPER(0.12/12,-100,-1000,10000)', 60.08212285); eq('=NPER(0.12/12,-100,-1000)', -9.57859404);
eq('=RATE(4*12,-200,8000)', 0.00770147248); eq('=RATE(12,-1000,10000)', 0.029228654); eq('=IPMT(0.1/12,1,3*12,8000)', -66.66666667); eq('=IPMT(0.1,3,3,8000)', -292.4471299); eq('=PPMT(0.1/12,1,2*12,2000)', -75.62318601);
eq('=PPMT(0.08,10,10,200000)', -27598.05346); eq('=NPV(0.1,-10000,3000,4200,6800)', 1188.443412); eq('=NPV(0.08,8000,9200,10000,12000,14500)', 41922.06155);
eq('=IRR(R1:R5)', -0.021244848); eq('=IRR(R1:R6)', 0.086630948); eq('=IRR(R1:R3,-0.1)', -0.443506941); eq('=XNPV(0.09,G1:G5,F1:F5)', 2086.647602); eq('=XIRR(G1:G5,F1:F5)', 0.373362535);
eq('=MIRR({-120000,39000,30000,21000,37000,46000},0.1,0.12)', 0.126094, 1e-5); eq('=SLN(30000,7500,10)', 2250); eq('=SYD(30000,7500,10,1)', 4090.909091); eq('=SYD(30000,7500,10,10)', 409.0909091);
eq('=DDB(2400,300,10*365,1)', 1.315068493); eq('=DDB(2400,300,10*12,1,2)', 40); eq('=DDB(2400,300,10,1,2)', 480); eq('=DDB(2400,300,10,2,1.5)', 306); eq('=DDB(2400,300,10,10)', 22.12254544);
eq('=DB(1000000,100000,6,1,7)', 186083.3333); eq('=DB(1000000,100000,6,2,7)', 259639.4167); eq('=DB(1000000,100000,6,7,7)', 15845.09847); eq('=EFFECT(0.0525,4)', 0.053542667); eq('=NOMINAL(0.053543,4)', 0.052500319);
eq('=CUMIPMT(0.09/12,30*12,125000,13,24,0)', -11135.23213); eq('=CUMIPMT(0.09/12,30*12,125000,1,1,0)', -937.5); eq('=CUMPRINC(0.09/12,30*12,125000,13,24,0)', -934.1071234); eq('=RRI(96,10000,11000)', 0.0009933);
eq('=PDURATION(0.025,2000,2200)', 3.859866163); eq('=FVSCHEDULE(1,{0.09,0.11,0.1})', 1.33089);

/* ---------- engine: dependencies, recalculation, cycles, spills ---------- */
t('dependency chain recalculates', () => {
  const w = M.Workbook.blank(); const s = w.sheets[0];
  w.load(s, { A1: 1, B1: '=A1*2', C1: '=B1+A1', D1: '=SUM(A1:C1)' });
  assert.deepStrictEqual([w.val('B1'), w.val('C1'), w.val('D1')], [2, 3, 6]);
  w.transact('e', () => w.input(s, 0, 0, '5')); assert.deepStrictEqual([w.val('B1'), w.val('C1'), w.val('D1')], [10, 15, 30]);
  w.undo(); assert.strictEqual(w.val('D1'), 6); w.redo(); assert.strictEqual(w.val('D1'), 30);
});
t('circular references are detected, not hung on', () => {
  const w = M.Workbook.blank(); const s = w.sheets[0];
  w.load(s, { A1: '=B1+1', B1: '=A1+1', C1: '=C1', D1: '=A1*2', E1: 5, F1: '=E1*2' });
  assert.strictEqual(w.val('A1').code, '#CIRC!'); assert.strictEqual(w.val('B1').code, '#CIRC!'); assert.strictEqual(w.val('C1').code, '#CIRC!');
  assert.ok(w.val('D1') instanceof F.FErr); assert.strictEqual(w.val('F1'), 10);
  assert.ok(w.circular.length >= 2);
  w.transact('fix', () => w.input(s, 0, 1, '7')); assert.strictEqual(w.val('A1'), 8); assert.strictEqual(w.val('D1'), 16);
});
t('siblings are not mistaken for cycles', () => {
  const w = M.Workbook.blank(); const s = w.sheets[0];
  w.load(s, { A1: '=B1+C1', B1: '=C1*2', C1: 3 }); assert.strictEqual(w.val('A1'), 9);
  w.load(s, { E1: '=SUM(F1:F3)', F1: '=F2+1', F2: '=F3+1', F3: 1 }); assert.strictEqual(w.val('E1'), 6);
});
t('100,000-cell dependency chain (no recursion limits)', () => {
  const w = M.Workbook.blank(); const s = w.sheets[0];
  const t0 = Date.now();
  w.transact('chain', () => { w.setCell(s, 0, 0, { v: 1 }); for (let r = 1; r < 100000; r++) w.setCell(s, r, 0, { f: 'A' + r + '+1' }); w.setCell(s, 0, 1, { f: 'SUM(A1:A100000)' }); });
  assert.strictEqual(w.val('A100000'), 100000); assert.strictEqual(w.val('B1'), 100000 * 100001 / 2);
  w.transact('e', () => w.input(s, 0, 0, '2')); assert.strictEqual(w.val('A100000'), 100001);
  const ms = Date.now() - t0; if (ms > 15000) throw new Error('too slow: ' + ms + 'ms');
  console.log('  100k chain build + 2 recalcs:', ms, 'ms');
});
t('reverse-order chain + summary above data', () => {
  const w = M.Workbook.blank(); const s = w.sheets[0];
  w.transact('c', () => { for (let r = 0; r < 20000; r++) w.setCell(s, r, 0, { f: r === 19999 ? '1' : 'A' + (r + 2) + '+1' }); });
  assert.strictEqual(w.val('A1'), 20000);
});
t('cross-sheet references and sheet rename', () => {
  const w = M.Workbook.blank(2); const [a, b] = w.sheets;
  w.load(b, { A1: 4 }); w.load(a, { A1: '=Sheet2!A1*10' }); assert.strictEqual(w.val('A1'), 40);
  w.renameSheet(b, 'My Data'); assert.strictEqual(a.get(0, 0).f, "'My Data'!A1*10"); assert.strictEqual(w.val('A1', a), 40);
  w.transact('e', () => w.input(b, 0, 0, '5')); assert.strictEqual(w.val('A1', a), 50);
  w.deleteSheet(b); assert.strictEqual(w.val('A1', a).code, '#REF!');
});
t('dynamic arrays spill, block with #SPILL! and recover', () => {
  const w = M.Workbook.blank(); const s = w.sheets[0];
  w.load(s, { A1: '=SEQUENCE(3)', B1: '=SUM(A1:A3)', C1: '=A2*10' });
  assert.deepStrictEqual([w.val('A1'), w.val('A2'), w.val('A3'), w.val('B1'), w.val('C1')], [1, 2, 3, 6, 20]);
  w.transact('block', () => w.input(s, 1, 0, 'x')); assert.strictEqual(w.val('A1').code, '#SPILL!');
  w.transact('unblock', () => w.input(s, 1, 0, '')); assert.strictEqual(w.val('A2'), 2); assert.strictEqual(w.val('C1'), 20);
  w.load(s, { E1: '=SORT(G1:G3)', G1: 3, G2: 1, G3: 2 }); assert.deepStrictEqual([w.val('E1'), w.val('E2'), w.val('E3')], [1, 2, 3]);
  w.transact('e', () => w.input(s, 0, 6, '0')); assert.deepStrictEqual([w.val('E1'), w.val('E2'), w.val('E3')], [0, 1, 2]);
});
t('volatile functions recalc every time', () => { const w = M.Workbook.blank(); const s = w.sheets[0]; w.load(s, { A1: '=RAND()' }); const a = w.val('A1'); w.recalc(); assert.notStrictEqual(w.val('A1'), a); });
t('formula shifting (fill/copy) keeps $ anchors', () => {
  assert.strictEqual(F.shiftFormula('=A1+$B$2+Sheet2!C$3+$D4', 1, 1), '=B2+$B$2+Sheet2!D$3+$D5');
  assert.strictEqual(F.shiftFormula('=SUM(A1:B2)', 2, 0), '=SUM(A3:B4)');
  assert.strictEqual(F.shiftFormula('=A1', -1, 0), '=#REF!');
  assert.strictEqual(F.shiftFormula('=SUM(A:A)+"A1"', 0, 1), '=SUM(B:B)+"A1"');
});
t('insert/delete rows adjusts references', () => {
  const w = M.Workbook.blank(); const s = w.sheets[0];
  w.load(s, { A1: 1, A2: 2, A3: 3, B1: '=SUM(A1:A3)', B2: '=A3*2' });
  w.insertRows(s, 1, 2); // two rows above row 2
  assert.strictEqual(s.get(0, 1).f, 'SUM(A1:A5)'); assert.strictEqual(s.get(3, 1).f, 'A5*2'); assert.strictEqual(w.val('B1'), 6); assert.strictEqual(w.val('A5'), 3);
  w.insertRows(s, 4, -1); // delete row 5 (the 3)
  assert.strictEqual(s.get(3, 1).f, '#REF!*2'); assert.strictEqual(w.val('B1'), 3);
  w.undo(); assert.strictEqual(w.val('B1'), 6); assert.strictEqual(s.get(3, 1).f, 'A5*2');
  w.insertCols(s, 0, 1); assert.strictEqual(s.get(0, 2).f, 'SUM(B1:B5)');
});
t('sort moves rows and their relative formulas', () => {
  const w = M.Workbook.blank(); const s = w.sheets[0];
  w.load(s, { A1: 'Name', B1: 'Qty', C1: 'Double', A2: 'b', B2: 2, C2: '=B2*2', A3: 'c', B3: 3, C3: '=B3*2', A4: 'a', B4: 1, C4: '=B4*2' });
  w.sortRange(s, { r1: 0, c1: 0, r2: 3, c2: 2 }, [{ col: 0, asc: true }], true);
  assert.deepStrictEqual([w.val('A2'), w.val('A3'), w.val('A4')], ['a', 'b', 'c']); assert.deepStrictEqual([w.val('C2'), w.val('C3'), w.val('C4')], [2, 4, 6]);
  assert.strictEqual(s.get(1, 2).f, 'B2*2');
  w.sortRange(s, { r1: 0, c1: 0, r2: 3, c2: 2 }, [{ col: 1, asc: false }], true); assert.deepStrictEqual([w.val('B2'), w.val('B3'), w.val('B4')], [3, 2, 1]);
});
t('fill series: numbers, dates, text+number, months, formulas', () => {
  const w = M.Workbook.blank(); const s = w.sheets[0];
  w.load(s, { A1: 1, A2: 3, B1: 'Item 1', C1: 'Jan', D1: '2024-01-31', E1: '=A1*10', F1: 5, G1: 'Q3', H1: 'Mon' });
  w.fill(s, { r1: 0, c1: 0, r2: 1, c2: 0 }, { r1: 0, c1: 0, r2: 4, c2: 0 }, 'down');
  assert.deepStrictEqual([2, 3, 4].map(r => s.value(r, 0)), [5, 7, 9]);
  w.fill(s, { r1: 0, c1: 1, r2: 0, c2: 7 }, { r1: 0, c1: 1, r2: 3, c2: 7 }, 'down');
  assert.deepStrictEqual([1, 2].map(r => s.value(r, 1)), ['Item 2', 'Item 3']);
  assert.deepStrictEqual([1, 2, 3].map(r => s.value(r, 2)), ['Feb', 'Mar', 'Apr']);
  assert.strictEqual(s.value(1, 3), Fmt.dateToSerial(2024, 2, 1));
  assert.strictEqual(s.get(1, 4).f, 'A2*10'); assert.strictEqual(s.value(1, 4), 30);
  assert.deepStrictEqual([1, 2].map(r => s.value(r, 5)), [5, 5]);
  assert.deepStrictEqual([1, 2].map(r => s.value(r, 6)), ['Q4', 'Q1']);
  assert.deepStrictEqual([1, 2].map(r => s.value(r, 7)), ['Tue', 'Wed']);
  w.fill(s, { r1: 0, c1: 0, r2: 1, c2: 0 }, { r1: 0, c1: 0, r2: 1, c2: 2 }, 'right');
});
t('paste shifts formulas, transposes, pastes values', () => {
  const w = M.Workbook.blank(); const s = w.sheets[0];
  w.load(s, { A1: 1, A2: 2, B1: '=A1*2', B2: '=A2*2' });
  const clip = w.copyRange(s, { r1: 0, c1: 0, r2: 1, c2: 1 });
  w.pasteClip(s, 0, 3, clip); assert.strictEqual(s.get(0, 4).f, 'D1*2'); assert.strictEqual(w.val('E2'), 4);
  w.pasteClip(s, 5, 0, clip, { transpose: true }); assert.deepStrictEqual([w.val('A6'), w.val('B6')], [1, 2]);
  w.pasteClip(s, 10, 0, clip, { values: true }); assert.strictEqual(s.get(10, 1).f, undefined); assert.strictEqual(w.val('B11'), 2);
});
t('number entry parsing', () => {
  const w = M.Workbook.blank(); const s = w.sheets[0];
  const inp = (txt) => { w.transact('i', () => w.input(s, 0, 0, txt)); const c = s.get(0, 0); return [c.v, c.s && c.s.nf]; };
  assert.deepStrictEqual(inp('12%'), [0.12, '0%']); assert.deepStrictEqual(inp('$1,234.50'), [1234.5, '$#,##0.00']); assert.deepStrictEqual(inp('2024-03-15'), [Fmt.dateToSerial(2024, 3, 15), 'yyyy-mm-dd']);
  assert.deepStrictEqual(inp('3/15/2024')[0], Fmt.dateToSerial(2024, 3, 15)); assert.deepStrictEqual(inp('13:30')[0], 13.5 / 24); assert.deepStrictEqual(inp('1,000')[0], 1000); assert.deepStrictEqual(inp('(50)')[0], -50);
  assert.deepStrictEqual(inp("'00123")[0], '00123'); assert.deepStrictEqual(inp('TRUE')[0], true); assert.strictEqual(inp('#N/A')[0].code, '#N/A'); assert.deepStrictEqual(inp('1e3')[0], 1000); assert.deepStrictEqual(inp('abc 12')[0], 'abc 12');
});
t('number formats', () => {
  const f = (v, c) => Fmt.format(v, c).text;
  assert.strictEqual(f(1234.5, '#,##0.00'), '1,234.50'); assert.strictEqual(f(-1234.5, '#,##0.00;[Red]-#,##0.00'), '-1,234.50'); assert.strictEqual(Fmt.format(-1, '0;[Red]-0').color, '#ff0000');
  assert.strictEqual(f(0.5, '0%'), '50%'); assert.strictEqual(f(1e6, '0.0,,"M"'), '1.0M'); assert.strictEqual(f(45000, 'mmmm'), 'March'); assert.strictEqual(f(45000, 'ddd d mmm'), 'Wed 15 Mar');
  assert.strictEqual(f(0.5, 'h:mm:ss AM/PM'), '12:00:00 PM'); assert.strictEqual(f(1 / 3, '# ??/??'), '  1/3 '); assert.strictEqual(f(2.75, '# ?/?'), '2 3/4');
  assert.strictEqual(f(1234.5, '_($* #,##0.00_)'), ' $1,234.50 '); assert.strictEqual(f('hi', '0;0;0;"<"@">"'), '<hi>'); assert.strictEqual(f(12345678901, 'General'), '12345678901');
  assert.strictEqual(Fmt.general(1 / 3), '0.333333333'); assert.strictEqual(Fmt.general(123456789012), '1.23457E+11'); assert.strictEqual(Fmt.general(0.1 + 0.2), '0.3'); assert.strictEqual(Fmt.general(-0.0000000001), '-1E-10');
  assert.strictEqual(f(3.14159, '0.00'), '3.14'); assert.strictEqual(f(0, '#,##0'), '0'); assert.strictEqual(f(0.004, '0.00'), '0.00'); assert.strictEqual(f(-0.004, '0.00'), '0.00');
});
t('.lsheet round trip keeps formulas, styles, merges and charts', () => {
  const w = M.Workbook.blank(2); const s = w.sheets[0];
  w.load(s, { A1: 'x', A2: 5, B2: '=A2*3' });
  w.transact('s', () => { w.setStyle(s, 1, 1, { b: 1, fill: '#ffeeaa', nf: '0.00' }); w.setMeta(s, 'merges', [{ r1: 0, c1: 0, r2: 0, c2: 2 }]); w.setMeta(s, 'charts', [{ id: 'c1', type: 'line', range: 'A1:B2', x: 1, y: 2, w: 300, h: 200, title: 'T' }]); });
  const js = JSON.parse(JSON.stringify(w.toJSON()));
  const w2 = M.Workbook.fromJSON(js), s2 = w2.sheets[0];
  assert.strictEqual(w2.val('B2'), 15); assert.deepStrictEqual(s2.get(1, 1).s, { b: 1, fill: '#ffeeaa', nf: '0.00' }); assert.strictEqual(s2.merges.length, 1); assert.strictEqual(s2.charts[0].title, 'T');
  assert.strictEqual(w2.display(s2, 1, 1).text, '15.00');
});
t('hostile .lsheet content is sanitised (no code, bad types dropped)', () => {
  const js = { format: 'lumen-sheets', version: 1, styles: [{ fill: 'red;background:url(x)', font: '<script>', b: 1 }], sheets: [{ name: 'S', cells: [[0, 0, { evil: 1 }], [0, 1, 'ok', null, 0], [-1, 0, 5], [0, 2, null, 'constructor.constructor("alert(1)")()'], [0, 3, null, 'SUM(1,2)']], charts: [{ type: 'evil', range: 'A1' }], cf: [{ type: 'formula', range: { r1: 0, c1: 0, r2: 0, c2: 0 }, v1: 'process.exit()' }] }] };
  const w = M.Workbook.fromJSON(js), s = w.sheets[0];
  assert.strictEqual(s.value(0, 0), null); assert.strictEqual(s.value(0, 1), 'ok'); assert.deepStrictEqual(s.get(0, 1).s, { b: 1 });
  assert.ok(s.value(0, 2) instanceof F.FErr); assert.strictEqual(s.value(0, 3), 3); assert.strictEqual(s.charts.length, 0);
  assert.strictEqual(w.cfFormat(s, 0, 0), null);
});
t('conditional formats', () => {
  const w = M.Workbook.blank(); const s = w.sheets[0];
  w.load(s, { A1: 1, A2: 5, A3: 10, A4: 5 });
  const g = { r1: 0, c1: 0, r2: 3, c2: 0 };
  w.transact('cf', () => w.setMeta(s, 'cf', [{ type: 'cell', op: '>', v1: '4', range: g, style: { fill: '#ff0000' } }, { type: 'dup', range: g, style: { b: 1 } }, { type: 'formula', v1: 'A1=MAX($A$1:$A$4)', range: g, style: { color: '#00ff00' } }, { type: 'bar', range: g, color: '#0000ff' }]));
  assert.strictEqual(w.cfFormat(s, 0, 0).fill, undefined); assert.strictEqual(w.cfFormat(s, 1, 0).fill, '#ff0000'); assert.strictEqual(w.cfFormat(s, 1, 0).b, 1); assert.strictEqual(w.cfFormat(s, 2, 0).color, '#00ff00');
  approx(w.cfFormat(s, 2, 0).bar.pct, 1); approx(w.cfFormat(s, 1, 0).bar.pct, 0.5);
});
t('find & replace', () => {
  const w = M.Workbook.blank(); const s = w.sheets[0];
  w.load(s, { A1: 'apple pie', A2: 'Apple', B1: 'grape', B2: '=A2&"s"' });
  assert.strictEqual(w.find([s], 'apple', {}).length, 3); assert.strictEqual(w.find([s], 'apple', { matchCase: true }).length, 1); assert.strictEqual(w.find([s], 'apple', { whole: true }).length, 1);
  assert.strictEqual(w.replaceAll([s], 'apple', 'pear', {}), 2); assert.strictEqual(w.val('A1'), 'pear pie'); assert.strictEqual(w.val('B2'), 'pears');
});
t('filter hides rows and SUBTOTAL skips them', () => {
  const w = M.Workbook.blank(); const s = w.sheets[0];
  w.load(s, { A1: 'K', A2: 'x', A3: 'y', A4: 'x', B1: 'V', B2: 1, B3: 2, B4: 3, D1: '=SUBTOTAL(9,B2:B4)', D2: '=SUM(B2:B4)' });
  w.transact('f', () => { w.setMeta(s, 'filter', { range: { r1: 0, c1: 0, r2: 3, c2: 1 }, crit: { 0: { values: ['x'] } } }); w.applyFilter(s); });
  assert.deepStrictEqual([...s.filtered], [2]); assert.strictEqual(w.val('D1'), 4); assert.strictEqual(w.val('D2'), 6);
});

const n = Object.keys(F.FN).length;
console.log(`${pass} passed, ${fail} failed — ${n} functions registered`);
if (fails.length) { console.log(fails.join('\n')); process.exit(1); }
