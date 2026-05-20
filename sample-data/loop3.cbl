       IDENTIFICATION DIVISION.
       PROGRAM-ID. LOOP2.

       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  REC-INDEX           PIC S9(9) COMP VALUE 0.
       01  I                   PIC S9(9) COMP VALUE 0.
       01  J                   PIC S9(9) COMP VALUE 0.
       01  K                   PIC S9(9) COMP VALUE 0.
       01  SUM-CPU             PIC S9(18) COMP VALUE 0.
       01  TEMP-VALUE          PIC S9(18) COMP VALUE 0.
       01  THRESHOLD-VALUE     PIC S9(9)  COMP VALUE 5000.
       01  FLAG-HIGH           PIC X      VALUE 'N'.

       PROCEDURE DIVISION.

       MAIN-LOOP.
          
           PERFORM VARYING REC-INDEX FROM 1 BY 1 UNTIL REC-INDEX > 5000

             
              PERFORM VARYING I FROM 1 BY 1 UNTIL I > 50
                 PERFORM VARYING J FROM 1 BY 1 UNTIL J > 40
                    PERFORM VARYING K FROM 1 BY 1 UNTIL K > 20
                       COMPUTE TEMP-VALUE =
                                (REC-INDEX * I * J * K)
                              + (I * I)
                              + (J * J)
                              + (K * K)
                       ADD TEMP-VALUE TO SUM-CPU

                       IF TEMP-VALUE > THRESHOLD-VALUE
                          MOVE 'Y' TO FLAG-HIGH
                       END-IF
                    END-PERFORM
                 END-PERFORM
              END-PERFORM

              
              IF FLAG-HIGH = 'Y'
                 PERFORM VARYING I FROM 1 BY 1 UNTIL I > 100
                    COMPUTE TEMP-VALUE = SUM-CPU / (I + 1)
                    ADD TEMP-VALUE TO SUM-CPU
                 END-PERFORM
                 MOVE 'N' TO FLAG-HIGH
              END-IF

           END-PERFORM

           DISPLAY "LOOP2 SUM-CPU = " SUM-CPU
           STOP RUN.