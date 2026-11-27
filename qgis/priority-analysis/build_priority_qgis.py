"""
Generator proyek QGIS (`priority_analysis.qgz`), gaya simbologi (.qml), dan Print Layout PNG
untuk modul Fire Service Priority Planner (`priority-planner`).
"""

from __future__ import annotations

import os
from pathlib import Path
import zipfile

from qgis.core import (
    Qgis,
    QgsApplication,
    QgsCategorizedSymbolRenderer,
    QgsCoordinateReferenceSystem,
    QgsCoordinateTransform,
    QgsFillSymbol,
    QgsLayoutExporter,
    QgsLayoutItemLabel,
    QgsLayoutItemLegend,
    QgsLayoutItemMap,
    QgsLayoutItemMapGrid,
    QgsLayoutItemPolygon,
    QgsLayoutItemScaleBar,
    QgsLayoutItemShape,
    QgsLayoutPoint,
    QgsLayoutSize,
    QgsLegendStyle,
    QgsLineSymbol,
    QgsMarkerSymbol,
    QgsPalLayerSettings,
    QgsPrintLayout,
    QgsProject,
    QgsRendererCategory,
    QgsTextBufferSettings,
    QgsTextFormat,
    QgsUnitTypes,
    QgsVectorLayer,
    QgsVectorLayerSimpleLabeling,
)
from qgis.PyQt.QtCore import QPointF, Qt
from qgis.PyQt.QtGui import QColor, QFont, QPolygonF

SCRIPT_DIR = Path(__file__).resolve().parent
QGZ_PATH = SCRIPT_DIR / "priority_analysis.qgz"
PNG_PATH = SCRIPT_DIR / "exports" / "peta_prioritas_layanan_kebakaran_medan_provisional.png"
STYLES_DIR = SCRIPT_DIR / "styles"


def _make_font(family: str, size_pt: float, bold: bool = False) -> QFont:
    font = QFont(family, int(round(size_pt)))
    font.setPointSizeF(size_pt)
    font.setBold(bold)
    return font


def _style_priority_layer(layer: QgsVectorLayer) -> None:
    specs = [
        ("Sangat Tinggi", "Sangat Tinggi (Prioritas Utama)", "#7F1D1D", "#450A0A"),
        ("Tinggi", "Tinggi", "#C8523B", "#852D1C"),
        ("Sedang", "Sedang", "#E79E4F", "#A6631B"),
        ("Rendah", "Rendah", "#E9C46A", "#9E7E2E"),
    ]
    cats = []
    for val, label, fill_hex, stroke_hex in specs:
        sym = QgsFillSymbol.createSimple(
            {"color": fill_hex, "outline_color": stroke_hex, "outline_width": "0.35", "outline_style": "solid"}
        )
        sym.setOpacity(0.80)
        cats.append(QgsRendererCategory(val, sym, label))
    layer.setRenderer(QgsCategorizedSymbolRenderer("priority_tier", cats))

    lbl = QgsPalLayerSettings()
    lbl.fieldName = "concat('#', \"priority_rank\", ' ', replace(\"area_name\", 'Medan ', 'M. '))"
    lbl.isExpression = True
    fmt = QgsTextFormat()
    fmt.setFont(_make_font("Sans Serif", 6.8, bold=True))
    fmt.setSize(6.8)
    fmt.setColor(QColor("#202A2D"))
    buf = QgsTextBufferSettings()
    buf.setEnabled(True)
    buf.setSize(0.85)
    buf.setColor(QColor("#FFFFFF"))
    fmt.setBuffer(buf)
    lbl.setFormat(fmt)
    layer.setLabeling(QgsVectorLayerSimpleLabeling(lbl))
    layer.setLabelsEnabled(True)


def _style_boundary(layer: QgsVectorLayer) -> None:
    sym = QgsFillSymbol.createSimple({"color": "0,0,0,0", "outline_color": "#202A2D", "outline_width": "0.4"})
    layer.renderer().setSymbol(sym)


def _style_mako(layer: QgsVectorLayer) -> None:
    sym = QgsMarkerSymbol.createSimple(
        {"name": "square", "color": "#356067", "outline_color": "#FFFFFF", "outline_width": "0.55", "size": "3.4"}
    )
    layer.renderer().setSymbol(sym)


def _add_rect(layout, x, y, w, h, fill_hex, stroke_hex=None, stroke_w=0.3):
    s = QgsLayoutItemShape(layout)
    s.setShapeType(QgsLayoutItemShape.Rectangle)
    s.attemptMove(QgsLayoutPoint(x, y, QgsUnitTypes.LayoutMillimeters))
    s.attemptResize(QgsLayoutSize(w, h, QgsUnitTypes.LayoutMillimeters))
    props = {"color": fill_hex}
    if stroke_hex:
        props["outline_color"] = stroke_hex
        props["outline_width"] = str(stroke_w)
        props["outline_style"] = "solid"
    else:
        props["outline_style"] = "no"
    s.setSymbol(QgsFillSymbol.createSimple(props))
    layout.addLayoutItem(s)
    return s


def _add_label(layout, text, x, y, w, h, size, color="#202A2D", bold=False, mono=False, halign=Qt.AlignmentFlag.AlignLeft):
    lbl = QgsLayoutItemLabel(layout)
    lbl.setText(text)
    lbl.attemptMove(QgsLayoutPoint(x, y, QgsUnitTypes.LayoutMillimeters))
    lbl.attemptResize(QgsLayoutSize(w, h, QgsUnitTypes.LayoutMillimeters))
    fmt = QgsTextFormat()
    fmt.setFont(_make_font("IBM Plex Mono" if mono else "Sans Serif", size, bold=bold))
    fmt.setSize(size)
    fmt.setColor(QColor(color))
    lbl.setTextFormat(fmt)
    lbl.setHAlign(halign)
    lbl.setMarginX(1.0)
    lbl.setMarginY(0.5)
    layout.addLayoutItem(lbl)
    return lbl


def _add_north_arrow(layout, cx, cy):
    poly = QPolygonF([QPointF(cx, cy - 5.5), QPointF(cx + 3.2, cy + 4.0), QPointF(cx, cy + 1.8), QPointF(cx - 3.2, cy + 4.0), QPointF(cx, cy - 5.5)])
    item = QgsLayoutItemPolygon(poly, layout)
    item.setSymbol(QgsFillSymbol.createSimple({"color": "#202A2D", "outline_color": "#202A2D", "outline_width": "0.2"}))
    layout.addLayoutItem(item)
    _add_label(layout, "U", cx - 3.0, cy + 4.3, 6.0, 4.5, 7.5, bold=True, halign=Qt.AlignmentFlag.AlignHCenter)


def build_project() -> None:
    STYLES_DIR.mkdir(parents=True, exist_ok=True)
    PNG_PATH.parent.mkdir(parents=True, exist_ok=True)

    qgs = QgsApplication([], False)
    qgs.initQgis()
    try:
        os.chdir(SCRIPT_DIR)
        project = QgsProject.instance()
        project.clear()
        project.setFileName(QGZ_PATH.name)
        project.setFilePathStorage(Qgis.FilePathType.Relative)

        utm_crs = QgsCoordinateReferenceSystem("EPSG:32647")
        wgs_crs = QgsCoordinateReferenceSystem("EPSG:4326")
        project.setCrs(utm_crs)
        project.setTitle("FireReach Medan - Priority Planner 21 Kecamatan (Provisional)")

        mako_lyr = QgsVectorLayer("./layers/priority_analysis.gpkg|layername=mako_verified", "Mako 0.0 Damkarmat Medan (Terverifikasi)", "ogr")
        bound_lyr = QgsVectorLayer("./layers/medan_districts_osm.geojson", "Batas 21 Kecamatan Medan (Fallback OSM)", "ogr")
        prio_lyr = QgsVectorLayer("./layers/priority_analysis.gpkg|layername=priority_districts_21_utm", "Skor Prioritas Layanan 21 Kecamatan (PROVISIONAL)", "ogr")

        for lyr, name in ((mako_lyr, "mako"), (bound_lyr, "boundary"), (prio_lyr, "priority")):
            if not lyr.isValid():
                raise RuntimeError(f"Layer QGIS gagal dimuat: {name}")

        _style_mako(mako_lyr)
        _style_boundary(bound_lyr)
        _style_priority_layer(prio_lyr)
        prio_lyr.saveNamedStyle(str(STYLES_DIR / "priority_tier_4kelas.qml"))

        for lyr in (mako_lyr, bound_lyr, prio_lyr):
            project.addMapLayer(lyr, False)
        root = project.layerTreeRoot()
        for lyr in (mako_lyr, bound_lyr, prio_lyr):
            root.addLayer(lyr)

        layout = QgsPrintLayout(project)
        layout.initializeDefaults()
        layout.setName("Layout Prioritas Layanan Kebakaran 21 Kecamatan")
        layout.pageCollection().page(0).setPageSize("A4", layout.pageCollection().page(0).Orientation.Landscape)

        _add_rect(layout, 0.0, 0.0, 297.0, 210.0, "#F4F2EC")
        _add_rect(layout, 10.0, 8.0, 277.0, 20.5, "#FFFFFF", "#D9DEDA", 0.3)
        _add_rect(layout, 10.0, 8.0, 2.0, 20.5, "#B84A35")
        _add_label(layout, "Peta Prioritas Peningkatan Layanan Pemadam Kebakaran Kota Medan (PROVISIONAL)", 15.0, 10.0, 266.0, 9.0, 13.0, bold=True)
        _add_label(layout, "Indeks Komposit 21 Kecamatan (0.40 Beban Kebakaran 2023 + 0.35 Gap Jaringan 5 km Mako 0.0 + 0.25 Paparan Penduduk 2025)", 15.0, 18.8, 266.0, 7.0, 8.5, color="#556164")

        ct = QgsCoordinateTransform(wgs_crs, utm_crs, project)
        utm_extent = ct.transformBoundingBox(bound_lyr.extent())
        utm_extent.scale(1.12)

        map_item = QgsLayoutItemMap(layout)
        map_item.attemptMove(QgsLayoutPoint(10.0, 31.0, QgsUnitTypes.LayoutMillimeters))
        map_item.attemptResize(QgsLayoutSize(183.0, 160.0, QgsUnitTypes.LayoutMillimeters))
        map_item.setCrs(utm_crs)
        map_item.setLayers([mako_lyr, bound_lyr, prio_lyr])
        map_item.zoomToExtent(utm_extent)
        map_item.setBackgroundEnabled(True)
        map_item.setBackgroundColor(QColor("#FFFFFF"))
        map_item.setFrameEnabled(True)
        map_item.setFrameStrokeColor(QColor("#202A2D"))

        grid = QgsLayoutItemMapGrid("UTM 47N Grid", map_item)
        grid.setEnabled(True)
        grid.setCrs(utm_crs)
        grid.setIntervalX(5000.0)
        grid.setIntervalY(5000.0)
        grid.setAnnotationEnabled(True)
        grid.setAnnotationPrecision(0)
        grid.setAnnotationDisplay(QgsLayoutItemMapGrid.ShowAll, QgsLayoutItemMapGrid.Left)
        grid.setAnnotationDisplay(QgsLayoutItemMapGrid.ShowAll, QgsLayoutItemMapGrid.Bottom)
        grid.setAnnotationDisplay(QgsLayoutItemMapGrid.HideAll, QgsLayoutItemMapGrid.Right)
        grid.setAnnotationDisplay(QgsLayoutItemMapGrid.HideAll, QgsLayoutItemMapGrid.Top)
        grid.setAnnotationDirection(QgsLayoutItemMapGrid.Vertical, QgsLayoutItemMapGrid.Left)
        g_fmt = QgsTextFormat()
        g_fmt.setFont(_make_font("IBM Plex Mono", 6.5))
        g_fmt.setSize(6.5)
        g_fmt.setColor(QColor("#556164"))
        grid.setAnnotationTextFormat(g_fmt)
        grid.setLineSymbol(QgsLineSymbol.createSimple({"line_color": "217,222,218,175", "line_width": "0.18"}))
        map_item.grids().addGrid(grid)
        layout.addLayoutItem(map_item)

        _add_rect(layout, 197.0, 31.0, 90.0, 160.0, "#FFFFFF", "#D9DEDA", 0.3)

        legend = QgsLayoutItemLegend(layout)
        legend.setTitle("Legenda Prioritas")
        legend.setLinkedMap(map_item)
        legend.setAutoUpdateModel(False)
        legend.setStyleFont(QgsLegendStyle.Title, _make_font("Sans Serif", 9.0, bold=True))
        legend.setStyleFont(QgsLegendStyle.Subgroup, _make_font("Sans Serif", 7.5, bold=True))
        legend.setStyleFont(QgsLegendStyle.SymbolLabel, _make_font("Sans Serif", 7.0))
        legend.setSymbolWidth(5.2)
        legend.setSymbolHeight(3.2)
        legend.attemptMove(QgsLayoutPoint(200.0, 33.0, QgsUnitTypes.LayoutMillimeters))
        legend.attemptResize(QgsLayoutSize(84.0, 72.0, QgsUnitTypes.LayoutMillimeters))
        layout.addLayoutItem(legend)

        scale_bar = QgsLayoutItemScaleBar(layout)
        scale_bar.setLinkedMap(map_item)
        scale_bar.setStyle("Single Box")
        scale_bar.setUnits(QgsUnitTypes.DistanceKilometers)
        scale_bar.setUnitLabel("km")
        scale_bar.setNumberOfSegments(2)
        scale_bar.setNumberOfSegmentsLeft(0)
        scale_bar.setUnitsPerSegment(2.5)
        scale_bar.setHeight(2.5)
        scale_bar.setFont(_make_font("IBM Plex Mono", 7.0))
        scale_bar.attemptMove(QgsLayoutPoint(200.0, 108.0, QgsUnitTypes.LayoutMillimeters))
        scale_bar.attemptResize(QgsLayoutSize(62.0, 11.0, QgsUnitTypes.LayoutMillimeters))
        layout.addLayoutItem(scale_bar)
        _add_north_arrow(layout, 276.0, 113.0)

        _add_rect(layout, 200.0, 123.0, 84.0, 65.0, "#FBF2E6", "#D58A43", 0.3)
        _add_rect(layout, 200.0, 123.0, 1.5, 65.0, "#8A5218")
        _add_label(
            layout,
            "METODE, SUMBER & KETERBATASAN\n"
            "1. Normalisasi Min-Max (0-1) pada 21 kecamatan (area_code 12.71.01-12.71.21); klasifikasi 4 kelas Quantile.\n"
            "2. Faktor kebakaran memakai agregat 2023 per 10.000 jiwa (219 kejadian, BUKAN hasil KDE titik).\n"
            "3. Gap layanan berstatus PROVISIONAL karena baru menghitung jaringan 5 km dari Mako 0.0 (pos UPT belum tersedia).\n"
            "4. Sumber: Damkarmat Medan 2023, BPS Medan 2025, Geofabrik OSM 2026-11-21 (© OpenStreetMap contributors, ODbL).\n"
            "5. CRS: EPSG:32647 | Label '#N' = peringkat komposit.",
            203.0,
            125.0,
            79.0,
            61.0,
            6.5,
        )

        _add_label(
            layout,
            "FireReach Medan | Modul: priority-planner (Olo) | Proyek: priority_analysis.qgz | CRS Peta: EPSG:32647 (UTM 47N)",
            10.0,
            200.5,
            277.0,
            6.5,
            7.5,
            color="#556164",
            mono=True,
        )

        project.layoutManager().addLayout(layout)
        if not project.write(str(QGZ_PATH)):
            raise RuntimeError("Gagal menulis priority_analysis.qgz")

        with zipfile.ZipFile(QGZ_PATH, "r") as zf:
            qgs_name = next(n for n in zf.namelist() if n.endswith(".qgs"))
            xml_text = zf.read(qgs_name).decode("utf-8", errors="replace")
            if "C:\\" in xml_text or "C:/" in xml_text or "firereach-medan" in xml_text:
                raise RuntimeError("priority_analysis.qgz masih mengandung path absolut!")

        exporter = QgsLayoutExporter(layout)
        settings = QgsLayoutExporter.ImageExportSettings()
        settings.dpi = 150
        res = exporter.exportToImage(str(PNG_PATH), settings)
        if res != QgsLayoutExporter.Success:
            raise RuntimeError(f"Gagal ekspor PNG priority_analysis: {res}")

        print(f"Berhasil membuat {QGZ_PATH} dan {PNG_PATH}")
    finally:
        QgsProject.instance().clear()
        qgs.exitQgis()


if __name__ == "__main__":
    build_project()
