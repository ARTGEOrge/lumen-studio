'use strict';
// Minimal ECMA-376 conformance checks for the parts Lumen Slides writes: child element order of the complex types
// we emit (PowerPoint rejects out-of-order children), unknown children, and integer-valued geometry attributes.
const XML = require('../js/xml.js');
const FILL = ['a:noFill', 'a:solidFill', 'a:gradFill', 'a:blipFill', 'a:pattFill', 'a:grpFill'];
const EFFECT = ['a:effectLst', 'a:effectDag'];
const SHAPES = ['p:sp', 'p:grpSp', 'p:graphicFrame', 'p:cxnSp', 'p:pic', 'p:contentPart', 'mc:AlternateContent'];
const PPR = ['a:lnSpc', 'a:spcBef', 'a:spcAft', ['a:buClrTx', 'a:buClr'], ['a:buSzTx', 'a:buSzPct', 'a:buSzPts'], ['a:buFontTx', 'a:buFont'], ['a:buNone', 'a:buAutoNum', 'a:buChar', 'a:buBlip'], 'a:tabLst', 'a:defRPr', 'a:extLst'];
const RPR = ['a:ln', FILL, EFFECT, 'a:highlight', ['a:uLnTx', 'a:uLn'], ['a:uFillTx', 'a:uFill'], 'a:latin', 'a:ea', 'a:cs', 'a:sym', 'a:hlinkClick', 'a:hlinkMouseOver', 'a:rtl', 'a:extLst'];
const SPPR = ['a:xfrm', ['a:custGeom', 'a:prstGeom'], FILL, 'a:ln', EFFECT, 'a:scene3d', 'a:sp3d', 'a:extLst'];
const LVLS = ['a:defPPr', 'a:lvl1pPr', 'a:lvl2pPr', 'a:lvl3pPr', 'a:lvl4pPr', 'a:lvl5pPr', 'a:lvl6pPr', 'a:lvl7pPr', 'a:lvl8pPr', 'a:lvl9pPr', 'a:extLst'];
const BAR_SER = ['c:idx', 'c:order', 'c:tx', 'c:spPr', 'c:invertIfNegative', 'c:pictureOptions', 'c:dPt', 'c:dLbls', 'c:trendline', 'c:errBars', 'c:cat', 'c:val', 'c:shape', 'c:extLst'];
const LINE_SER = ['c:idx', 'c:order', 'c:tx', 'c:spPr', 'c:marker', 'c:dPt', 'c:dLbls', 'c:trendline', 'c:errBars', 'c:cat', 'c:val', 'c:smooth', 'c:extLst'];
const PIE_SER = ['c:idx', 'c:order', 'c:tx', 'c:spPr', 'c:explosion', 'c:dPt', 'c:dLbls', 'c:cat', 'c:val', 'c:extLst'];
const AREA_SER = ['c:idx', 'c:order', 'c:tx', 'c:spPr', 'c:pictureOptions', 'c:dPt', 'c:dLbls', 'c:trendline', 'c:errBars', 'c:cat', 'c:val', 'c:extLst'];
const AX_COMMON = ['c:axId', 'c:scaling', 'c:delete', 'c:axPos', 'c:majorGridlines', 'c:minorGridlines', 'c:title', 'c:numFmt', 'c:majorTickMark', 'c:minorTickMark', 'c:tickLblPos', 'c:spPr', 'c:txPr', 'c:crossAx', ['c:crosses', 'c:crossesAt']];
const TRANS = ['p:blinds', 'p:checker', 'p:circle', 'p:dissolve', 'p:comb', 'p:cover', 'p:cut', 'p:diamond', 'p:fade', 'p:newsflash', 'p:plus', 'p:pull', 'p:push', 'p:random', 'p:randomBar', 'p:split', 'p:strips', 'p:wedge', 'p:wheel', 'p:wipe', 'p:zoom'];
const SEQ = {
  'p:sld': ['p:cSld', 'p:clrMapOvr', ['p:transition', 'mc:AlternateContent'], 'p:timing', 'p:extLst'],
  'p:sldLayout': ['p:cSld', 'p:clrMapOvr', 'p:transition', 'p:timing', 'p:hf', 'p:extLst'],
  'p:sldMaster': ['p:cSld', 'p:clrMap', 'p:sldLayoutIdLst', 'p:transition', 'p:timing', 'p:hf', 'p:txStyles', 'p:extLst'],
  'p:notes': ['p:cSld', 'p:clrMapOvr', 'p:extLst'], 'p:notesMaster': ['p:cSld', 'p:clrMap', 'p:hf', 'p:notesStyle', 'p:extLst'],
  'p:cSld': ['p:bg', 'p:spTree', 'p:custDataLst', 'p:controls', 'p:extLst'], 'p:bg': [['p:bgPr', 'p:bgRef']], 'p:bgPr': [FILL, EFFECT, 'p:extLst'],
  'p:spTree': ['p:nvGrpSpPr', 'p:grpSpPr', SHAPES, 'p:extLst'], 'p:grpSp': ['p:nvGrpSpPr', 'p:grpSpPr', SHAPES, 'p:extLst'],
  'p:nvGrpSpPr': ['p:cNvPr', 'p:cNvGrpSpPr', 'p:nvPr'], 'p:grpSpPr': ['a:xfrm', FILL, EFFECT, 'a:scene3d', 'a:extLst'],
  'p:sp': ['p:nvSpPr', 'p:spPr', 'p:style', 'p:txBody', 'p:extLst'], 'p:nvSpPr': ['p:cNvPr', 'p:cNvSpPr', 'p:nvPr'], 'p:spPr': SPPR,
  'p:nvPr': ['p:ph', 'a:audioCd', 'a:wavAudioFile', 'a:audioFile', 'a:videoFile', 'a:quickTimeFile', 'p:custDataLst', 'p:extLst'],
  'a:xfrm': ['a:off', 'a:ext', 'a:chOff', 'a:chExt'], 'p:xfrm': ['a:off', 'a:ext'],
  'p:txBody': ['a:bodyPr', 'a:lstStyle', 'a:p'], 'a:txBody': ['a:bodyPr', 'a:lstStyle', 'a:p'],
  'a:bodyPr': ['a:prstTxWarp', ['a:noAutofit', 'a:normAutofit', 'a:spAutoFit'], 'a:scene3d', 'a:sp3d', 'a:flatTx', 'a:extLst'],
  'a:p': ['a:pPr', ['a:r', 'a:br', 'a:fld'], 'a:endParaRPr'], 'a:pPr': PPR, 'a:lvl1pPr': PPR, 'a:lvl2pPr': PPR, 'a:lvl3pPr': PPR, 'a:lvl4pPr': PPR, 'a:lvl5pPr': PPR, 'a:lvl6pPr': PPR, 'a:lvl7pPr': PPR, 'a:lvl8pPr': PPR, 'a:lvl9pPr': PPR, 'a:defPPr': PPR,
  'a:rPr': RPR, 'a:defRPr': RPR, 'a:endParaRPr': RPR, 'a:r': ['a:rPr', 'a:t'], 'a:fld': ['a:rPr', 'a:pPr', 'a:t'], 'a:br': ['a:rPr'],
  'a:lstStyle': LVLS, 'p:titleStyle': LVLS, 'p:bodyStyle': LVLS, 'p:otherStyle': LVLS, 'p:notesStyle': LVLS, 'p:defaultTextStyle': LVLS,
  'a:ln': [['a:noFill', 'a:solidFill', 'a:gradFill', 'a:pattFill'], ['a:prstDash', 'a:custDash'], ['a:round', 'a:bevel', 'a:miter'], 'a:headEnd', 'a:tailEnd', 'a:extLst'],
  'a:gradFill': ['a:gsLst', ['a:lin', 'a:path'], 'a:tileRect'],
  'p:pic': ['p:nvPicPr', 'p:blipFill', 'p:spPr', 'p:style', 'p:extLst'], 'p:nvPicPr': ['p:cNvPr', 'p:cNvPicPr', 'p:nvPr'], 'p:blipFill': ['a:blip', 'a:srcRect', ['a:tile', 'a:stretch']],
  'p:graphicFrame': ['p:nvGraphicFramePr', 'p:xfrm', 'a:graphic', 'p:extLst'], 'p:nvGraphicFramePr': ['p:cNvPr', 'p:cNvGraphicFramePr', 'p:nvPr'],
  'a:tbl': ['a:tblPr', 'a:tblGrid', 'a:tr'], 'a:tr': ['a:tc', 'a:extLst'], 'a:tc': ['a:txBody', 'a:tcPr', 'a:extLst'],
  'a:tcPr': ['a:lnL', 'a:lnR', 'a:lnT', 'a:lnB', 'a:lnTlToBr', 'a:lnBlToTr', 'a:cell3D', FILL, 'a:headers', 'a:extLst'],
  'p:txStyles': ['p:titleStyle', 'p:bodyStyle', 'p:otherStyle', 'p:extLst'],
  'p:presentation': ['p:sldMasterIdLst', 'p:notesMasterIdLst', 'p:handoutMasterIdLst', 'p:sldIdLst', 'p:sldSz', 'p:notesSz', 'p:smartTags', 'p:embeddedFontLst', 'p:custShowLst', 'p:photoAlbum', 'p:custDataLst', 'p:kinsoku', 'p:defaultTextStyle', 'p:modifyVerifier', 'p:extLst'],
  'a:theme': ['a:themeElements', 'a:objectDefaults', 'a:extraClrSchemeLst', 'a:custClrLst', 'a:extLst'], 'a:themeElements': ['a:clrScheme', 'a:fontScheme', 'a:fmtScheme', 'a:extLst'],
  'a:clrScheme': ['a:dk1', 'a:lt1', 'a:dk2', 'a:lt2', 'a:accent1', 'a:accent2', 'a:accent3', 'a:accent4', 'a:accent5', 'a:accent6', 'a:hlink', 'a:folHlink', 'a:extLst'],
  'a:fontScheme': ['a:majorFont', 'a:minorFont', 'a:extLst'], 'a:majorFont': ['a:latin', 'a:ea', 'a:cs', 'a:font', 'a:extLst'], 'a:minorFont': ['a:latin', 'a:ea', 'a:cs', 'a:font', 'a:extLst'],
  'a:fmtScheme': ['a:fillStyleLst', 'a:lnStyleLst', 'a:effectStyleLst', 'a:bgFillStyleLst'],
  'p:transition': [TRANS, 'p:sndAc', 'p:extLst'], 'p:timing': ['p:tnLst', 'p:bldLst', 'p:extLst'],
  'p:cTn': ['p:stCondLst', 'p:endCondLst', 'p:endSync', 'p:iterate', 'p:childTnLst', 'p:subTnLst'], 'p:seq': ['p:cTn', 'p:prevCondLst', 'p:nextCondLst'], 'p:par': ['p:cTn'],
  'p:cBhvr': ['p:cTn', 'p:tgtEl', 'p:attrNameLst'], 'p:set': ['p:cBhvr', 'p:to'], 'p:anim': ['p:cBhvr', 'p:tavLst'], 'p:animEffect': ['p:cBhvr', 'p:progress'], 'p:animScale': ['p:cBhvr', 'p:by', 'p:from', 'p:to'], 'p:animRot': ['p:cBhvr'],
  'p:tav': ['p:val'], 'p:cond': [['p:tgtEl', 'p:tn', 'p:rtn']],
  'c:chartSpace': ['c:date1904', 'c:lang', 'c:roundedCorners', 'mc:AlternateContent', 'c:style', 'c:clrMapOvr', 'c:pivotSource', 'c:protection', 'c:chart', 'c:spPr', 'c:txPr', 'c:externalData', 'c:printSettings', 'c:userShapes', 'c:extLst'],
  'c:chart': ['c:title', 'c:autoTitleDeleted', 'c:pivotFmts', 'c:view3D', 'c:floor', 'c:sideWall', 'c:backWall', 'c:plotArea', 'c:legend', 'c:plotVisOnly', 'c:dispBlanksAs', 'c:showDLblsOverMax', 'c:extLst'],
  'c:plotArea': ['c:layout', ['c:barChart', 'c:lineChart', 'c:pieChart', 'c:doughnutChart', 'c:areaChart'], ['c:catAx', 'c:valAx'], 'c:dTable', 'c:spPr', 'c:extLst'],
  'c:barChart': ['c:barDir', 'c:grouping', 'c:varyColors', 'c:ser', 'c:dLbls', 'c:gapWidth', 'c:overlap', 'c:serLines', 'c:axId', 'c:extLst'],
  'c:lineChart': ['c:grouping', 'c:varyColors', 'c:ser', 'c:dLbls', 'c:dropLines', 'c:hiLowLines', 'c:upDownBars', 'c:marker', 'c:smooth', 'c:axId', 'c:extLst'],
  'c:areaChart': ['c:grouping', 'c:varyColors', 'c:ser', 'c:dLbls', 'c:dropLines', 'c:axId', 'c:extLst'],
  'c:pieChart': ['c:varyColors', 'c:ser', 'c:dLbls', 'c:firstSliceAng', 'c:extLst'], 'c:doughnutChart': ['c:varyColors', 'c:ser', 'c:dLbls', 'c:firstSliceAng', 'c:holeSize', 'c:extLst'],
  'c:catAx': [...AX_COMMON, 'c:auto', 'c:lblAlgn', 'c:lblOffset', 'c:tickLblSkip', 'c:tickMarkSkip', 'c:noMultiLvlLbl', 'c:extLst'],
  'c:valAx': [...AX_COMMON, 'c:crossBetween', 'c:majorUnit', 'c:minorUnit', 'c:dispUnits', 'c:extLst'],
  'c:title': ['c:tx', 'c:layout', 'c:overlay', 'c:spPr', 'c:txPr', 'c:extLst'], 'c:legend': ['c:legendPos', 'c:legendEntry', 'c:layout', 'c:overlay', 'c:spPr', 'c:txPr', 'c:extLst'],
  'c:marker': ['c:symbol', 'c:size', 'c:spPr', 'c:extLst'], 'c:strRef': ['c:f', 'c:strCache', 'c:extLst'], 'c:numRef': ['c:f', 'c:numCache', 'c:extLst'],
  'c:numCache': ['c:formatCode', 'c:ptCount', 'c:pt', 'c:extLst'], 'c:strCache': ['c:ptCount', 'c:pt', 'c:extLst'], 'c:scaling': ['c:logBase', 'c:orientation', 'c:max', 'c:min', 'c:extLst'],
  'c:dPt': ['c:idx', 'c:invertIfNegative', 'c:marker', 'c:bubble3D', 'c:explosion', 'c:spPr', 'c:pictureOptions', 'c:extLst'],
  'c:dLbls': ['c:dLbl', 'c:delete', 'c:numFmt', 'c:spPr', 'c:txPr', 'c:dLblPos', 'c:showLegendKey', 'c:showVal', 'c:showCatName', 'c:showSerName', 'c:showPercent', 'c:showBubbleSize', 'c:separator', 'c:showLeaderLines', 'c:leaderLines', 'c:extLst'],
  'c:spPr': SPPR, 'c:majorGridlines': ['c:spPr'], 'c:tx': [['c:strRef', 'c:rich', 'c:v']], 'c:rich': ['a:bodyPr', 'a:lstStyle', 'a:p'], 'c:txPr': ['a:bodyPr', 'a:lstStyle', 'a:p'],
};
for (const k of ['a:lnL', 'a:lnR', 'a:lnT', 'a:lnB']) SEQ[k] = SEQ['a:ln'];
const INT_ATTR = { 'a:off': ['x', 'y'], 'a:ext': ['cx', 'cy'], 'a:chOff': ['x', 'y'], 'a:chExt': ['cx', 'cy'], 'a:gridCol': ['w'], 'a:tr': ['h'], 'p:sldSz': ['cx', 'cy'], 'a:ln': ['w'], 'a:rPr': ['sz'], 'a:defRPr': ['sz'], 'a:endParaRPr': ['sz'], 'p:cNvPr': ['id'], 'a:spcPts': ['val'], 'a:spcPct': ['val'], 'a:gs': ['pos'], 'a:lin': ['ang'], 'a:xfrm': ['rot'], 'a:pPr': ['marL', 'indent', 'lvl'] };
const NONNEG = new Set(['cx', 'cy', 'w', 'h', 'sz', 'marL']);
function check(xmlText, part) {
  const errs = [];
  const root = XML.parse(xmlText);
  (function walk(e, parentName) {
    const seq = SEQ[e.n];
    if (seq) {
      let last = -1;
      const kids = e.c.filter(x => typeof x === 'object');
      for (const k of kids) {
        const idx = seq.findIndex(s => Array.isArray(s) ? s.includes(k.n) : s === k.n);
        if (idx < 0) { errs.push(`${part}: <${k.n}> not allowed in <${e.n}>`); continue; }
        if (idx < last) errs.push(`${part}: <${k.n}> out of order in <${e.n}> (after ${kids.map(x => x.n).slice(0, kids.indexOf(k)).join(',')})`);
        last = Math.max(last, idx);
      }
    }
    const ints = INT_ATTR[e.n];
    if (ints) for (const a of ints) if (e.a[a] != null && !(/^-?\d+$/.test(e.a[a]) && (!NONNEG.has(a) || +e.a[a] >= 0))) errs.push(`${part}: <${e.n} ${a}="${e.a[a]}"> must be ${NONNEG.has(a) ? 'a non-negative ' : 'an '}integer`);
    if (e.n === 'p:cNvPr' && (e.a.id == null || e.a.name == null)) errs.push(`${part}: p:cNvPr needs id and name`);
    for (const k of e.c) if (typeof k === 'object') walk(k, e.n);
  })(root, null);
  return errs;
}
module.exports = { check };
