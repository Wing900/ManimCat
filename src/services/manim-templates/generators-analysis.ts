export function generateDiffEqCode(): string {
  return `from manim import *
import numpy as np

class MainScene(Scene):
    def construct(self):
        # 创建微分方程
        eq = MathTex(r"\\frac{dy}{dx} + 2y = e^x")

        # 解题步骤
        step1 = MathTex(r"y = e^{-2x}\\int e^x \\cdot e^{2x} dx")
        step2 = MathTex(r"y = e^{-2x}\\int e^{3x} dx")
        step3 = MathTex(r"y = e^{-2x} \\cdot \\frac{1}{3}e^{3x} + Ce^{-2x}")
        step4 = MathTex(r"y = \\frac{1}{3}e^x + Ce^{-2x}")

        # 排列方程
        VGroup(
            eq, step1, step2, step3, step4
        ).arrange(DOWN, buff=0.5)

        # 创建图形
        axes = Axes(
            x_range=[-2, 2],
            y_range=[-2, 2],
            axis_config={"include_tip": True}
        )

        # 绘制特解（C=0）
        graph = axes.plot(
            lambda x: (1/3)*np.exp(x),
            color=YELLOW
        )

        # 动画
        self.play(Write(eq))
        self.wait()
        self.play(Write(step1))
        self.wait()
        self.play(Write(step2))
        self.wait()
        self.play(Write(step3))
        self.wait()
        self.play(Write(step4))
        self.wait()

        # 显示图形
        self.play(
            FadeOut(VGroup(eq, step1, step2, step3, step4))
        )
        self.play(Create(axes), Create(graph))
        self.wait()
`;
}

export function generateTrigCode(): string {
  return `from manim import *

class MainScene(Scene):
    def construct(self):
        # 创建坐标平面
        plane = NumberPlane(
            x_range=[-4, 4],
            y_range=[-2, 2],
            axis_config={"include_tip": True}
        )

        # 添加自定义标签
        x_label = Text("x").next_to(plane.x_axis.get_end(), RIGHT)
        y_label = Text("y").next_to(plane.y_axis.get_end(), UP)

        # 创建单位圆
        circle = Circle(radius=1, color=BLUE)

        # 创建角度追踪器
        theta = ValueTracker(0)

        # 创建在圆上移动的点
        dot = always_redraw(
            lambda: Dot(
                circle.point_at_angle(theta.get_value()),
                color=YELLOW
            )
        )

        # 创建显示正弦和余弦的线条
        x_line = always_redraw(
            lambda: Line(
                start=[circle.point_at_angle(theta.get_value())[0], 0, 0],
                end=circle.point_at_angle(theta.get_value()),
                color=GREEN
            )
        )

        y_line = always_redraw(
            lambda: Line(
                start=[0, 0, 0],
                end=[circle.point_at_angle(theta.get_value())[0], 0, 0],
                color=RED
            )
        )

        # 创建标签
        sin_label = Text("sin(theta)").next_to(x_line).set_color(GREEN)
        cos_label = Text("cos(theta)").next_to(y_line).set_color(RED)

        # 将所有内容添加到场景
        self.play(Create(plane), Write(x_label), Write(y_label))
        self.play(Create(circle))
        self.play(Create(dot))
        self.play(Create(x_line), Create(y_line))
        self.play(Write(sin_label), Write(cos_label))

        # 动画角度
        self.play(
            theta.animate.set_value(2*PI),
            run_time=4,
            rate_func=linear
        )
        self.wait()
`;
}

export function generateQuadraticCode(): string {
  return `from manim import *

class MainScene(Scene):
    def construct(self):
        # 创建坐标系
        axes = Axes(
            x_range=[-4, 4],
            y_range=[-2, 8],
            axis_config={"include_tip": True}
        )

        # 添加自定义标签
        x_label = Text("x").next_to(axes.x_axis.get_end(), RIGHT)
        y_label = Text("y").next_to(axes.y_axis.get_end(), UP)

        # 创建二次函数
        def func(x):
            return x**2

        graph = axes.plot(
            func,
            color=BLUE,
            x_range=[-3, 3]
        )

        # 创建标签和方程
        equation = Text("f(x) = x^2").to_corner(UL)

        # 创建点和值追踪器
        x = ValueTracker(-3)
        dot = always_redraw(
            lambda: Dot(
                axes.c2p(
                    x.get_value(),
                    func(x.get_value())
                ),
                color=YELLOW
            )
        )

        # 创建显示 x 和 y 值的线条
        v_line = always_redraw(
            lambda: axes.get_vertical_line(
                axes.input_to_graph_point(
                    x.get_value(),
                    graph
                ),
                color=RED
            )
        )
        h_line = always_redraw(
            lambda: axes.get_horizontal_line(
                axes.input_to_graph_point(
                    x.get_value(),
                    graph
                ),
                color=GREEN
            )
        )

        # 将所有内容添加到场景
        self.play(Create(axes), Write(x_label), Write(y_label))
        self.play(Create(graph))
        self.play(Write(equation))
        self.play(Create(dot), Create(v_line), Create(h_line))

        # 动画 x 值
        self.play(
            x.animate.set_value(3),
            run_time=6,
            rate_func=there_and_back
        )
        self.wait()
`;
}

export function generateBasicVisualizationCode(): string {
  return `from manim import *
import numpy as np

class MainScene(Scene):
    def construct(self):
        # 创建标题
        title = Text("Mathematical Visualization", font_size=36).to_edge(UP)

        # 创建坐标轴
        axes = Axes(
            x_range=[-5, 5, 1],
            y_range=[-3, 3, 1],
            axis_config={"include_tip": True},
            x_length=10,
            y_length=6
        )

        # 添加标签
        x_label = Text("x", font_size=24).next_to(axes.x_axis.get_end(), RIGHT)
        y_label = Text("y", font_size=24).next_to(axes.y_axis.get_end(), UP)

        # 创建函数图形
        sin_graph = axes.plot(lambda x: np.sin(x), color=BLUE)
        cos_graph = axes.plot(lambda x: np.cos(x), color=RED)

        # 创建函数标签
        sin_label = Text("sin(x)", font_size=24, color=BLUE).next_to(sin_graph, UP)
        cos_label = Text("cos(x)", font_size=24, color=RED).next_to(cos_graph, DOWN)

        # 创建移动的点
        moving_dot = Dot(color=YELLOW)
        moving_dot.move_to(axes.c2p(-5, 0))

        # 创建点的路径
        path = VMobject()
        path.set_points_smoothly([
            axes.c2p(x, np.sin(x))
            for x in np.linspace(-5, 5, 100)
        ])

        # 动画所有内容
        self.play(Write(title))
        self.play(Create(axes), Write(x_label), Write(y_label))
        self.play(Create(sin_graph), Write(sin_label))
        self.play(Create(cos_graph), Write(cos_label))
        self.play(Create(moving_dot))

        # 动画点沿正弦曲线移动
        self.play(
            MoveAlongPath(moving_dot, path),
            run_time=3,
            rate_func=linear
        )

        # 最后暂停
        self.wait()
`;
}
